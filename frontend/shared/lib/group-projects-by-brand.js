/** @param {Array<{ brand?: string, key: string, name: string }>} projects */
export function groupProjectsByBrand(projects) {
  const map = new Map();
  for (const project of projects) {
    const brand = project.brand?.trim() || 'Uncategorized';
    if (!map.has(brand)) map.set(brand, []);
    map.get(brand).push(project);
  }

  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brand, items]) => ({
      brand,
      projects: items.sort((a, b) => a.key.localeCompare(b.key)),
    }));
}
