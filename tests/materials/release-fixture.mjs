// PGlite only. No project client, URL, R2, provider or real identities.
import { readFile } from 'node:fs/promises';
import { catalogFixture, uid } from '../admin/catalog-fixture.mjs';
export { uid };
export const sqlFile = (name) =>
  readFile(new URL('../../database/migrations/' + name, import.meta.url), 'utf8');
export async function materialFixture() {
  const f = await catalogFixture();
  const { db, as, query, scalar } = f;
  await db.exec(await sqlFile('010-owner-admin-emails.sql'));
  await db.exec(`CREATE ROLE service_role;ALTER TABLE public.materials ADD COLUMN file_name text NOT NULL DEFAULT 'fixture.pdf', ADD COLUMN uploaded_by uuid REFERENCES public.users(id),ADD COLUMN storage_path text, ADD COLUMN uploaded_at timestamptz DEFAULT now();
    REVOKE ALL ON public.materials FROM PUBLIC,anon,authenticated; GRANT SELECT,INSERT,UPDATE ON public.materials TO authenticated;
    DROP POLICY material_write ON public.materials; CREATE POLICY upload_pending ON public.materials FOR INSERT TO authenticated WITH CHECK(uploaded_by=auth.uid() AND status='pending');
    CREATE POLICY admin_read ON public.materials FOR SELECT TO authenticated USING(EXISTS(SELECT FROM public.users u WHERE u.id=auth.uid() AND u.is_admin IS TRUE));
    CREATE POLICY admin_update ON public.materials FOR UPDATE TO authenticated USING(EXISTS(SELECT FROM public.users u WHERE u.id=auth.uid() AND u.is_admin IS TRUE));`);
  const key = (n) => 'materials/' + uid(3) + '/' + n + '_scan.pdf';
  const add = (n, title = 'Notes', k = key(n), status = 'pending') =>
    query(
      "INSERT INTO public.materials(id,file_name,material_name,storage_path,status,uploaded_by,level,semester,course) VALUES($1,'scan.pdf',$2,$3,$4,$5,'100L','second','Legal Method')",
      [uid(100 + n), title, k, status, uid(3)],
    );
  const service = async () => {
    await as(0);
    await db.exec('SET ROLE service_role');
  };
  return {
    ...f,
    key,
    add,
    service,
    async install() {
      await db.exec(await sqlFile('011-material-review.sql'));
    },
    review: (n, a = 1) => scalar('SELECT public.lh_material_review($1,$2)', [uid(a), uid(n + 100)]),
    change: (n, version, action, phrase, values = null, a = 1) =>
      scalar('SELECT public.lh_material_change($1,$2,$3,$4,$5,$6)', [
        uid(a),
        uid(n + 100),
        version,
        action,
        phrase,
        values ? JSON.stringify(values) : null,
      ]),
    remove: (n, v, action, phrase, a = 1) =>
      scalar('SELECT public.lh_material_remove($1,$2,$3,$4,$5)', [
        uid(a),
        uid(n + 100),
        v,
        action,
        phrase,
      ]),
  };
}
