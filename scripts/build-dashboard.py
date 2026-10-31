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


def brand_marks(nodes):
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            continue
        children = node['children']
        signature = any(isinstance(child, dict) and child['tag'] == 'svg' and
            'M7 5v14M12 8v8M17 5v14' in json.dumps(child) for child in children)
        next_node = next((item for item in nodes[index + 1:] if isinstance(item, dict) or item.strip()), None)
        empty_logo = not children and '#0A0A0A' in node['attrs'].get('style', '') and '디미' in json.dumps(next_node, ensure_ascii=False)
        if node['tag'] == 'span' and (signature or empty_logo):
            node['attrs']['class'] = 'dimi-mark'
            node['attrs']['aria-hidden'] = 'true'
            node['attrs']['style'] = ';'.join(part for part in node['attrs'].get('style', '').split(';')
                if part.strip().split(':')[0] not in ['background', 'border-radius', 'display', 'place-content'])
            node['children'] = []
        else:
            brand_marks(children)


def compile_page(source_path, name, model_name, output):
    source = (ROOT / source_path).read_text(encoding="utf-8")
    style = re.search(r"<style>(.*?)</style>", source, re.S).group(1)
    markup = re.search(r"</helmet>(.*?)</x-dc>", source, re.S).group(1)
    # The only source asset change is resolving the design tool's private blob URL.
    markup = markup.replace("/_blob/3651456fa0784f684fd353c526fe36bf", "/assets/mascot.png")
    markup = markup.replace("./assets/643336e9e4b4897d48e1aefd9715f721.png", "/assets/onboarding-mascot.png")
    for filename, route in [("Main.dc.html", "/dashboard"), ("Landing.dc.html", "/"), ("Signup.dc.html", "/register")]:
        markup = markup.replace(f'href="{filename}"', f'href="{route}"')
    markup = markup.replace('href="#top">@inthon2team', 'href="https://www.instagram.com/dimi_in/" target="_blank" rel="noopener noreferrer">@inthon2team')
    markup = markup.replace('서비스명이에요', '디미예요').replace('서비스명', '디미').replace('inthon2team', 'dimi_in')
    logic = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', source, re.S).group(1)
    parser = TemplateParser()
    parser.feed(markup)
    if parser.tags:
        raise ValueError("Unclosed template tags")
    brand_marks(parser.roots)
    public = ROOT / "public"
    for folder in ["js/vendor", "css", "data", "assets"]:
        (public / folder).mkdir(parents=True, exist_ok=True)
    (public / f"css/{name}.css").write_text(style, encoding="utf-8")
    (public / f"data/{name}-template.json").write_text(json.dumps(parser.roots, ensure_ascii=False), encoding="utf-8")
    module = "import { DCLogic } from './dashboard-runtime.js';\n" + logic.replace(
        "class Component extends DCLogic", f"export default class {model_name} extends DCLogic", 1).replace('서비스명이에요', '디미예요').replace('서비스명', '디미').replace('inthon2team', 'dimi_in')
    (public / f"js/{name}-model.js").write_text(module, encoding="utf-8")
    fonts = re.search(r'<link rel="stylesheet" href="([^"]+)"', source).group(1)
    title = {'dashboard': '디미 · 대시보드', 'landing': '디미 · 보낸 콘텐츠를 다시 쓰게', 'register': '디미 · 회원가입'}[name]
    shell = '''<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <link rel="icon" href="/assets/dimi-icon.svg" type="image/svg+xml">
  <title>__TITLE__</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="__FONTS__">
  <link rel="stylesheet" href="/css/__PAGE__.css">
  <link rel="stylesheet" href="/css/brand.css">
  <script type="module" src="/js/__PAGE__-app.js"></script>
</head>
<body><div id="app"></div><noscript>화면을 보려면 JavaScript를 켜주세요.</noscript></body>
</html>
'''
    (public / output).write_text(shell.replace("__PAGE__", name).replace("__TITLE__", title).replace("__FONTS__", fonts), encoding="utf-8")
    print(f"{name}: {parser.sequence} original elements; CSS and source state logic preserved")


def build():
    compile_page("frontend/design/Main.dc.html", "dashboard", "DashboardModel", "dashboard.html")
    compile_page("frontend/landing/Landing.dc.html", "landing", "LandingModel", "index.html")
    compile_page("frontend/register/Signup.dc.html", "register", "RegisterModel", "register.html")
    public = ROOT / "public"
    shutil.copyfile(ROOT / "frontend/assets/mascot.png", public / "assets/mascot.png")
    shutil.copyfile(ROOT / "frontend/assets/onboarding-mascot.png", public / "assets/onboarding-mascot.png")
    shutil.copyfile(ROOT / "frontend/data/sample-data.json", public / "data/dashboard-sample.json")
    shutil.copyfile(ROOT / "node_modules/preact/dist/preact.mjs", public / "js/vendor/preact.module.js")
    shutil.copyfile(ROOT / "node_modules/preact/dist/preact.mjs.map", public / "js/vendor/preact.mjs.map")
    shutil.copyfile(ROOT / "node_modules/preact/LICENSE", public / "js/vendor/preact.LICENSE")


if __name__ == "__main__":
    build()
