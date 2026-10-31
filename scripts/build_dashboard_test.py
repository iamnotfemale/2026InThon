import importlib.util
import re
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('dashboard_build', Path(__file__).with_name('build-dashboard.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class DashboardBuildChecks(unittest.TestCase):
    def test_supplied_css_and_model_logic_are_preserved(self):
        source = (build.ROOT / 'frontend/design/Main.dc.html').read_text(encoding='utf-8')
        css = re.search(r'<style>(.*?)</style>', source, re.S).group(1)
        self.assertEqual((build.ROOT / 'public/css/dashboard.css').read_text(encoding='utf-8'), css)
        logic = re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>', source, re.S).group(1)
        actual = (build.ROOT / 'public/js/dashboard-model.js').read_text(encoding='utf-8')
        self.assertEqual(actual, "import { DCLogic } from './dashboard-runtime.js';\n" + logic.replace(
            'class Component extends DCLogic', 'export default class DashboardModel extends DCLogic', 1))
        self.assertEqual((build.ROOT / 'frontend/assets/mascot.png').read_bytes(), (build.ROOT / 'public/assets/mascot.png').read_bytes())

    def test_nested_conditions_svg_case_and_boolean_attributes_survive_compilation(self):
        parser = build.TemplateParser()
        parser.feed('<sc-if value="{{show}}"><sc-for list="{{items}}" as="item"><input checked="{{item.checked}}"><svg viewBox="0 0 24 24"><defs><linearGradient id="test"><stop offset="0%"/></linearGradient></defs></svg></sc-for></sc-if>')
        children = parser.roots[0]['children'][0]['children']
        self.assertEqual(children[0]['attrs']['checked'], '{{item.checked}}')
        self.assertEqual(children[1]['attrs']['viewBox'], '0 0 24 24')
        self.assertEqual(children[1]['children'][0]['children'][0]['tag'], 'linearGradient')
        self.assertEqual(parser.tags, [])

    def test_invalid_nesting_fails_instead_of_silently_rearranging_design(self):
        parser = build.TemplateParser()
        with self.assertRaises(ValueError):
            parser.feed('<div><span></div>')


if __name__ == '__main__':
    unittest.main()
