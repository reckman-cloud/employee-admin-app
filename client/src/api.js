export const API = {
  lists: '/api/lists',
  submitAll: '/api/submit-all',
  health: '/api/health',
  offboard: '/api/offboard',
};

export async function fetchLists() {
  try {
    const response = await fetch(API.lists, { cache: 'no-store' });
    const data = await response.json();

    if (!response.ok) throw new Error('List fetch failed');

    return {
      departments: data.departments || [],
      businessUnits: data.businessUnits || [],
      managers: data.managers || [],
    };
  } catch {
    return { departments: [], businessUnits: [], managers: [] };
  }
}
