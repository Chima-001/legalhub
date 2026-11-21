export function createClient(url, key, opt = {}) {
  if (url !== 'https://fixture.invalid') throw Error('Refuse a non-fixture backend');
  const f = globalThis.fixture;
  if (key === 'fixture-anon')
    return {
      auth: {
        getUser: async () => ({
          data: {
            user: opt.global.headers.Authorization === 'Bearer fixture-session' ? { id: f.actor } : null,
          },
        }),
      },
    };
  if (key !== 'fixture-service') throw Error('Fixture key required');
  return {
    from(table) {
      const filters = {};
      let deleting = false;
      const item = () =>
        filters.storage_path === f.key && (!filters.id || filters.id === f.material)
          ? { id: f.material, storage_path: f.key, status: f.status, uploaded_by: f.uploader }
          : null;
      return {
        select() {
          return this;
        },
        eq(k, v) {
          filters[k] = v;
          return this;
        },
        delete() {
          deleting = true;
          return this;
        },
        async limit() {
          return { data: f.shared ? [item(), { id: 'other' }] : [item()] };
        },
        async single() {
          return {
            data: table === 'users' ? (filters.id === f.actor ? { is_admin: f.admin } : null) : item(),
          };
        },
        async maybeSingle() {
          const data = item();
          if (deleting && data) f.trace.push('row');
          return { data: deleting && f.zeroRow ? null : data };
        },
      };
    },
  };
}
