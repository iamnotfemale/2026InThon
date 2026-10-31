"""Compile the supplied design template without changing its markup/style values."""
import json
import re
import shutil
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
SVG_CASE = {"viewbox": "viewBox", "preserveaspectratio": "preserveAspectRatio", "gradientunits": "gradientUnits", "gradienttransform": "gradientTransform"}
SVG_TAG_CASE = {"lineargradient": "linearGradient"}


class TemplateParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.roots = []
        self.stack = [self.roots]
        self.tags = []
        self.sequence = 0

    def handle_starttag(self, tag, attrs):
        self.sequence += 1
        node = {"tag": SVG_TAG_CASE.get(tag, tag), "attrs": {SVG_CASE.get(k, k): v or "" for k, v in attrs if not k.startswith("hint-")},
                "id": self.sequence, "children": []}
        self.stack[-1].append(node)
        if tag not in VOID:
            self.stack.append(node["children"])
            self.tags.append(tag)

    def handle_endtag(self, tag):
        if tag not in VOID:
            if not self.tags or self.tags[-1] != tag:
                raise ValueError(f"Unbalanced template: {tag}")
            self.tags.pop()
            self.stack.pop()

    def handle_data(self, data):
        self.stack[-1].append(data)


def build():
    source = (ROOT / "frontend/design/Main.dc.html").read_text(encoding="utf-8")
    style = re.search(r"<style>(.*?)</style>", source, re.S).group(1)
    markup = re.search(r"</helmet>(.*?)</x-dc>", source, re.S).group(1)
    # The only source asset change is resolving the design tool's private blob URL.
    markup = markup.replace("/_blob/3651456fa0784f684fd353c526fe36bf", "/assets/mascot.png")
    logic = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', source, re.S).group(1)
    parser = TemplateParser()
    parser.feed(markup)
    if parser.tags:
        raise ValueError("Unclosed template tags")
    public = ROOT / "public"
    for folder in ["js/vendor", "css", "data", "assets"]:
        (public / folder).mkdir(parents=True, exist_ok=True)
    (public / "css/dashboard.css").write_text(style, encoding="utf-8")
    (public / "data/dashboard-template.json").write_text(json.dumps(parser.roots, ensure_ascii=False), encoding="utf-8")
    module = "import { DCLogic } from './dashboard-runtime.js';\n" + logic.replace(
        "class Component extends DCLogic", "export default class DashboardModel extends DCLogic", 1)
    (public / "js/dashboard-model.js").write_text(module, encoding="utf-8")
    shutil.copyfile(ROOT / "frontend/assets/mascot.png", public / "assets/mascot.png")
    shutil.copyfile(ROOT / "frontend/data/sample-data.json", public / "data/dashboard-sample.json")
    shutil.copyfile(ROOT / "node_modules/preact/dist/preact.mjs", public / "js/vendor/preact.module.js")
    shutil.copyfile(ROOT / "node_modules/preact/dist/preact.mjs.map", public / "js/vendor/preact.mjs.map")
    shutil.copyfile(ROOT / "node_modules/preact/LICENSE", public / "js/vendor/preact.LICENSE")
    shell = '''<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>DM 콘텐츠 도우미</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500&amp;family=Noto+Sans+KR:wght@400;500;600;700&amp;display=swap">
  <link rel="stylesheet" href="/css/dashboard.css">
  <script type="module" src="/js/dashboard-app.js"></script>
</head>
<body><div id="app"></div><noscript>화면을 보려면 JavaScript를 켜주세요.</noscript></body>
</html>
'''
    (public / "index.html").write_text(shell, encoding="utf-8")
    (public / "dashboard.html").write_text(shell, encoding="utf-8")
    print(f"Dashboard built: {parser.sequence} original elements; CSS and source state logic preserved")


if __name__ == "__main__":
    build()
