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
      let column, value;
      return {
        select() {
          return this;
        },
        eq(k, v) {
          column = k;
          value = v;
          return this;
        },
        single: async () => ({
          data:
            table === 'users' && column === 'id' && value === f.actor
              ? { is_admin: f.admin }
              : table === 'materials' && column === 'storage_path' && value === f.key
                ? { status: f.status }
                : null,
        }),
      };
    },
    async rpc(name, args) {
      if (name === 'lh_material_remove') {
        f.trace.push('review');
        return f.verified && args.p_actor === f.actor
          ? { data: { key: f.key, done: false } }
          : { error: { code: '40001' } };
      }
      if (name === 'lh_material_file_done') {
        f.trace.push('receipt');
        return { data: args.p_key === f.key };
      }
      throw Error('Unrecognized operation');
    },
  };
}
