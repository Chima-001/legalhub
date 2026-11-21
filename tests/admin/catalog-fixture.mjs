import { fixture } from './fixture.mjs';
import { readFile } from 'node:fs/promises';
export { uid } from './fixture.mjs';
export async function catalogFixture(install = true) {
  const fx = await fixture();
  await fx.bind();
  await fx.db.exec(fx.sql);
  await fx.db
    .exec(`CREATE TABLE public.courses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,code text,level text,semester text,created_at timestamptz DEFAULT now());
 CREATE TABLE public.cases(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
 CREATE TABLE public.course_case_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE,case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE);
 CREATE TABLE public.materials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),course text,level text,semester text,material_name text,status text DEFAULT 'pending');
 ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY; ALTER TABLE public.course_case_links ENABLE ROW LEVEL SECURITY; ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
 CREATE POLICY course_read ON public.courses FOR SELECT USING(true); CREATE POLICY links_read ON public.course_case_links FOR SELECT USING(true);
 CREATE POLICY material_read ON public.materials FOR SELECT USING(status='approved'); CREATE POLICY material_write ON public.materials FOR INSERT TO authenticated WITH CHECK(status='pending');`);
  Object.assign(fx.calls, {
    lh_curricula: ['p_actor'],
    lh_course_list: ['p_level', 'p_semester', 'p_include_archived'],
    lh_write_curriculum: [
      'p_actor',
      'p_action',
      'p_id',
      'p_revision',
      'p_name',
      'p_description',
      'p_phrase',
    ],
    lh_write_course: [
      'p_actor',
      'p_action',
      'p_id',
      'p_revision',
      'p_level',
      'p_semester',
      'p_curriculum',
      'p_curriculum_revision',
      'p_name',
      'p_code',
      'p_phrase',
    ],
  });
  fx.catalogSQL = await readFile(
    new URL('../../database/migrations/009-curricula-and-courses.sql', import.meta.url),
    'utf8',
  );
  if (install) await fx.db.exec(fx.catalogSQL);
  return fx;
}
