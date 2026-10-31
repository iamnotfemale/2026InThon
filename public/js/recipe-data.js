const text = (value, max, nullable = false) => {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid recipe text');
  return value.trim();
};
const array = (value, max) => { if (!Array.isArray(value) || value.length > max) throw new Error('Invalid recipe list'); return value; };

export function validateRecipe(value) {
  if (!value || typeof value !== 'object' || typeof value.is_recipe !== 'boolean') throw new Error('Invalid recipe');
  if (!value.is_recipe) return null;
  const ingredients = array(value.ingredients, 40).map(item => ({ name: text(item.name, 100), quantity: text(item.quantity, 150, true), optional: item.optional === true,
    group: text(item.group, 50), evidence: text(item.evidence, 400), conflict: text(item.conflict, 300, true) }));
  const names = new Set(ingredients.map(item => item.name));
  const steps = array(value.steps, 30).map(item => ({ text: text(item.text, 600), duration: text(item.duration, 60, true),
    heat: text(item.heat, 60, true), temperature: text(item.temperature, 60, true), evidence: text(item.evidence, 400),
    note: text(item.note, 400, true), uses: array(item.uses, 40).map(name => text(name, 100)).filter(name => names.has(name)) }));
  if (!ingredients.length || !steps.length) throw new Error('Incomplete recipe');
  return { version: 1, title: text(value.title, 120), summary: text(value.summary, 800),
    serving: text(value.serving, 60, true), prep: text(value.prep, 60, true), cook: text(value.cook, 60, true), total: text(value.total, 60, true),
    ingredients, steps, tips: array(value.tips, 10).map(item => ({ text: text(item.text, 400), evidence: text(item.evidence, 400) })),
    checks: array(value.checks, 55).map(item => text(item, 400)) };
}
