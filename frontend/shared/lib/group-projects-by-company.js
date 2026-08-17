/** @param {Array<{ client?: { id?: string, name?: string }, brand?: string, key: string }>} projects */
export function groupProjectsByCompany(projects) {
  const map = new Map();

  for (const project of projects) {
    const company = project.client;
    const companyId = company?.id ?? company ?? 'unknown';
    const companyName = company?.name ?? project.brand?.trim() ?? 'Uncategorized';
    const key = String(companyId);

    if (!map.has(key)) {
      map.set(key, {
        company: company ?? { id: key, name: companyName },
        projects: [],
      });
    }
    map.get(key).projects.push(project);
  }

  return [...map.values()]
    .sort((a, b) => a.company.name.localeCompare(b.company.name))
    .map((group) => ({
      ...group,
      projects: group.projects.sort((a, b) => a.key.localeCompare(b.key)),
    }));
}
