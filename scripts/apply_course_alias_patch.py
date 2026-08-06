from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:100]!r}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "src/lib/domain.ts",
    """export interface AdminCourseNameRecord {
  id: string
  course_name: string
  status: 'active' | 'disabled' | 'merged'
  source: 'approved' | 'legacy' | 'user' | 'admin'
  section_count: number
  active_section_count: number
  created_at: string
  updated_at: string
}
""",
    """export interface AdminCourseAliasRecord {
  id: string
  alias: string
  source: 'admin' | 'import_correction' | 'migration' | 'system'
  source_import_id: string | null
  learned_count: number
  last_seen_at: string
  created_at: string
}

export interface AdminCourseNameRecord {
  id: string
  course_name: string
  status: 'active' | 'disabled' | 'merged'
  source: 'approved' | 'legacy' | 'user' | 'admin'
  section_count: number
  active_section_count: number
  alias_count: number
  aliases: AdminCourseAliasRecord[]
  created_at: string
  updated_at: string
}
""",
)

replace_once(
    "src/lib/supabase/data.ts",
    """export async function adminListCourseNames(): Promise<AdminCourseNameRecord[]> {
  const client = requireClient()
  const { data, error } = await client.rpc('admin_list_course_names')
  if (error) throw error
  return (data as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.course_name_id as string,
    course_name: row.course_name as string,
    status: row.status as AdminCourseNameRecord['status'],
    source: row.source as AdminCourseNameRecord['source'],
    section_count: Number(row.section_count),
    active_section_count: Number(row.active_section_count),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }))
}
""",
    """export async function adminListCourseNames(): Promise<AdminCourseNameRecord[]> {
  const data = await callUntypedRpc('admin_list_course_names')
  return (data as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.course_name_id),
    course_name: String(row.course_name),
    status: String(row.status) as AdminCourseNameRecord['status'],
    source: String(row.source) as AdminCourseNameRecord['source'],
    section_count: Number(row.section_count),
    active_section_count: Number(row.active_section_count),
    alias_count: Number(row.alias_count ?? 0),
    aliases: (Array.isArray(row.aliases) ? row.aliases : []).flatMap((value) => {
      const alias = recordFrom(value)
      if (!alias || typeof alias.id !== 'string' || typeof alias.alias !== 'string') return []
      return [{
        id: alias.id,
        alias: alias.alias,
        source: String(alias.source) as AdminCourseNameRecord['aliases'][number]['source'],
        source_import_id: stringOrNull(alias.source_import_id),
        learned_count: Number(alias.learned_count ?? 1),
        last_seen_at: String(alias.last_seen_at ?? ''),
        created_at: String(alias.created_at ?? ''),
      }]
    }).sort((left, right) => left.alias.localeCompare(right.alias)),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }))
}
""",
)

replace_once(
    "supabase/functions/schedule-import/core.ts",
    """export interface CourseRecord {
  id: string
  name: string
  term_policy?: CourseTermPolicy
}
""",
    """export interface CourseRecord {
  id: string
  name: string
  aliases?: string[]
  term_policy?: CourseTermPolicy
}
""",
)

replace_once(
    "supabase/functions/schedule-import/core.ts",
    """    || typeof course.name !== 'string'
    || course.name.trim().length < 2
    || (course.term_policy !== undefined && !isCourseTermPolicy(course.term_policy))
""",
    """    || typeof course.name !== 'string'
    || course.name.trim().length < 2
    || (course.aliases !== undefined && (!Array.isArray(course.aliases) || course.aliases.some((alias) => typeof alias !== 'string' || alias.trim().length < 2)))
    || (course.term_policy !== undefined && !isCourseTermPolicy(course.term_policy))
""",
)

replace_once(
    "supabase/functions/schedule-import/core.ts",
    """export function findCourseMatch(sourceName: string, catalog: CourseRecord[]): CourseMatch {
  const ranked = catalog
    .map((course) => ({ course, score: courseSimilarity(sourceName, course.name) }))
    .sort((left, right) => right.score - left.score || left.course.name.localeCompare(right.course.name))
""",
    """export function findCourseMatch(sourceName: string, catalog: CourseRecord[]): CourseMatch {
  const ranked = catalog
    .map((course) => ({
      course,
      score: Math.max(
        courseSimilarity(sourceName, course.name),
        ...(course.aliases ?? []).map((alias) => courseSimilarity(sourceName, alias)),
      ),
    }))
    .sort((left, right) => right.score - left.score || left.course.name.localeCompare(right.course.name))
""",
)

replace_once(
    "supabase/functions/schedule-import/index.ts",
    """      .from('course_names')
      .select('id, name, term_policy')
      .eq('status', 'active')
      .order('name')
      .range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as CourseRecord[]
    records.push(...page)
""",
    """      .from('course_names')
      .select('id, name, term_policy, course_name_aliases(alias)')
      .eq('status', 'active')
      .order('name')
      .range(offset, offset + 999)
    if (error) throw error
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>
    records.push(...page.map((row) => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      term_policy: row.term_policy as CourseRecord['term_policy'],
      aliases: Array.isArray(row.course_name_aliases)
        ? row.course_name_aliases.flatMap((value) => {
            const alias = isRecord(value) && typeof value.alias === 'string' ? value.alias.trim() : ''
            return alias ? [alias] : []
          })
        : [],
    })))
""",
)

replace_once(
    "supabase/functions/schedule-import/core.test.ts",
    """  it('rejects invalid, out-of-range, and nonconsecutive slots', () => {
    expect(() => normalizeSlots(['A0'])).toThrow('invalid meeting slots')
    expect(() => normalizeSlots(['A1', 'A3'])).toThrow('invalid meeting slots')
    expect(() => normalizeSlots(['C2'])).toThrow('invalid meeting slots')
  })
""",
    """  it('rejects invalid, out-of-range, and nonconsecutive slots', () => {
    expect(() => normalizeSlots(['A0'])).toThrow('invalid meeting slots')
    expect(() => normalizeSlots(['A1', 'A3'])).toThrow('invalid meeting slots')
    expect(() => normalizeSlots(['C2'])).toThrow('invalid meeting slots')
  })

  it('matches an exact course alias to its canonical catalogue course', () => {
    const canonical = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'AP Government',
      aliases: ['AP US Government & Comparative Politics'],
      term_policy: 'full_year' as const,
    }
    expect(findCourseMatch('AP US Government & Comparative Politics', [canonical])).toEqual({
      kind: 'matched',
      course: canonical,
      score: 1,
      alternatives: [],
    })
  })
""",
)

replace_once(
    "src/pages/AdminPage.tsx",
    """  source: 'approved',
  section_count: 1,
  active_section_count: 1,
  created_at: new Date().toISOString(),
""",
    """  source: 'approved',
  section_count: 1,
  active_section_count: 1,
  alias_count: 0,
  aliases: [],
  created_at: new Date().toISOString(),
""",
)

replace_once(
    "src/pages/AdminPage.tsx",
    """  if (message.includes('not_admin') || message.includes('administrator')) return 'Administrator access is required for this action.'
  if (message.includes('foreign key') || message.includes('violates')) return 'The class section could not be deleted because a related record was not handled safely. No changes were kept; refresh and try again.'
""",
    """  if (message.includes('not_admin') || message.includes('administrator')) return 'Administrator access is required for this action.'
  if (message.includes('course_alias_already_exists')) return 'That possible name is already assigned to a course.'
  if (message.includes('alias_conflicts_with_course_name') || message.includes('course_name_conflicts_with_alias')) return 'That name is already used by another catalogue course.'
  if (message.includes('alias_matches_canonical_name')) return 'The possible name is already the course’s canonical name.'
  if (message.includes('invalid_course_alias')) return 'Enter a possible course name between 2 and 160 characters.'
  if (message.includes('foreign key') || message.includes('violates')) return 'The class section could not be deleted because a related record was not handled safely. No changes were kept; refresh and try again.'
""",
)

replace_once(
    "src/pages/AdminPage.tsx",
    """  const [duplicateCourseNameId, setDuplicateCourseNameId] = useState('')
  const [courseCatalogExpanded, setCourseCatalogExpanded] = useState(false)
  const visibleClasses = courseFilter ? classes.filter((course) => course.course_name_id === courseFilter) : classes
""",
    """  const [duplicateCourseNameId, setDuplicateCourseNameId] = useState('')
  const [courseCatalogExpanded, setCourseCatalogExpanded] = useState(false)
  const [aliasCourseId, setAliasCourseId] = useState<string | null>(null)
  const visibleClasses = courseFilter ? classes.filter((course) => course.course_name_id === courseFilter) : classes
  const selectedAliasCourse = courseNames.find((course) => course.id === aliasCourseId) ?? null
""",
)

replace_once(
    "src/pages/AdminPage.tsx",
    """  function renameCourseName(courseName: AdminCourseNameRecord) {
    const name = window.prompt('Rename course', courseName.course_name)?.trim()
    if (!name || name === courseName.course_name) return
    void onAdminAction('admin_rename_course_name', { p_course_name_id: courseName.id, p_name: name, p_reason: 'Renamed from admin course catalog' }, `${courseName.course_name} was renamed to ${name}.`)
  }
""",
    """  function renameCourseName(courseName: AdminCourseNameRecord) {
    const name = window.prompt('Rename course', courseName.course_name)?.trim()
    if (!name || name === courseName.course_name) return
    void onAdminAction('admin_rename_course_name', { p_course_name_id: courseName.id, p_name: name, p_reason: 'Renamed from admin course catalog' }, `${courseName.course_name} was renamed to ${name}.`)
  }

  function addCourseAlias(courseName: AdminCourseNameRecord) {
    const alias = window.prompt(`Add another possible name for ${courseName.course_name}`)?.trim()
    if (!alias) return
    void onAdminAction('admin_add_course_name_alias', {
      p_course_name_id: courseName.id,
      p_alias: alias,
      p_reason: 'Added from admin course catalog',
    }, `${alias} will now match ${courseName.course_name}.`)
  }

  function deleteCourseAlias(courseName: AdminCourseNameRecord, aliasId: string, alias: string) {
    if (!window.confirm(`Remove “${alias}” as a possible name for ${courseName.course_name}?`)) return
    void onAdminAction('admin_delete_course_name_alias', {
      p_alias_id: aliasId,
      p_reason: 'Removed from admin course catalog',
    }, `${alias} was removed from ${courseName.course_name}.`)
  }
""",
)

old_table = """    <div className=\"admin-table admin-course-table\"><div className=\"admin-table-head\"><span>Course name</span><span>Source</span><span>Sections</span><span>Status</span><span>Actions</span></div>{courseNames.map((courseName) => <div className=\"admin-table-row\" key={courseName.id}><span><strong>{courseName.course_name}</strong><small>{courseName.id}</small></span><span>{courseName.source}</span><span><strong>{courseName.active_section_count} active</strong><small>{courseName.section_count} total</small></span><span>{courseName.status}</span><span className=\"row-actions\"><button type=\"button\" onClick={() => onCourseFilter(courseName.id)}>View sections</button>{courseName.status !== 'merged' ? <button type=\"button\" onClick={() => renameCourseName(courseName)}>Rename</button> : null}{courseName.status !== 'merged' ? <button className={courseName.status === 'active' ? 'danger-text' : ''} type=\"button\" onClick={() => { const enabling = courseName.status !== 'active'; if (window.confirm(`${enabling ? 'Enable' : 'Disable'} ${courseName.course_name}? Existing schedules keep their linked name.`)) void onAdminAction('admin_set_course_name_enabled', { p_course_name_id: courseName.id, p_enabled: enabling, p_reason: `${enabling ? 'Enabled' : 'Disabled'} from admin course catalog` }, `${courseName.course_name} was ${enabling ? 'enabled' : 'disabled'}.`) }}>{courseName.status === 'active' ? 'Disable' : 'Enable'}</button> : null}</span></div>)}</div>
"""
new_table = """    <div className=\"admin-table admin-course-table\"><div className=\"admin-table-head\"><span>Course name</span><span>Source</span><span>Sections</span><span>Status</span><span>Actions</span></div>{courseNames.map((courseName) => <div className=\"admin-table-row\" key={courseName.id}><span><strong>{courseName.course_name}</strong><small>{courseName.alias_count > 0 ? `${courseName.alias_count} possible name${courseName.alias_count === 1 ? '' : 's'}` : 'No alternate names'}</small><small>{courseName.id}</small></span><span>{courseName.source}</span><span><strong>{courseName.active_section_count} active</strong><small>{courseName.section_count} total</small></span><span>{courseName.status}</span><span className=\"row-actions\"><button type=\"button\" onClick={() => onCourseFilter(courseName.id)}>View sections</button>{courseName.status !== 'merged' ? <button type=\"button\" onClick={() => setAliasCourseId(courseName.id)}>Possible names</button> : null}{courseName.status !== 'merged' ? <button type=\"button\" onClick={() => renameCourseName(courseName)}>Rename</button> : null}{courseName.status !== 'merged' ? <button className={courseName.status === 'active' ? 'danger-text' : ''} type=\"button\" onClick={() => { const enabling = courseName.status !== 'active'; if (window.confirm(`${enabling ? 'Enable' : 'Disable'} ${courseName.course_name}? Existing schedules keep their linked name.`)) void onAdminAction('admin_set_course_name_enabled', { p_course_name_id: courseName.id, p_enabled: enabling, p_reason: `${enabling ? 'Enabled' : 'Disabled'} from admin course catalog` }, `${courseName.course_name} was ${enabling ? 'enabled' : 'disabled'}.`) }}>{courseName.status === 'active' ? 'Disable' : 'Enable'}</button> : null}</span></div>)}</div>
    {selectedAliasCourse ? <div className=\"course-alias-manager\"><div className=\"section-heading\"><div><h3>Possible names for {selectedAliasCourse.course_name}</h3><p>The importer and catalogue search accept every name below but continue displaying the canonical course name.</p></div><div className=\"course-catalog-actions\"><button className=\"button button-primary\" type=\"button\" onClick={() => addCourseAlias(selectedAliasCourse)}><Plus size={16} /> Add possible name</button><button className=\"button button-secondary\" type=\"button\" onClick={() => setAliasCourseId(null)}>Close</button></div></div>{selectedAliasCourse.aliases.length === 0 ? <p className=\"notice-box\">No alternate names have been added or learned yet.</p> : <div className=\"admin-table admin-course-table\"><div className=\"admin-table-head\"><span>Possible name</span><span>Source</span><span>Learned</span><span>Last seen</span><span>Actions</span></div>{selectedAliasCourse.aliases.map((alias) => <div className=\"admin-table-row\" key={alias.id}><span><strong>{alias.alias}</strong><small>{alias.id}</small></span><span>{alias.source.replaceAll('_', ' ')}</span><span>{alias.learned_count.toLocaleString()} time{alias.learned_count === 1 ? '' : 's'}</span><span>{alias.last_seen_at ? new Date(alias.last_seen_at).toLocaleString() : '—'}</span><span className=\"row-actions\"><button className=\"danger-text\" type=\"button\" onClick={() => deleteCourseAlias(selectedAliasCourse, alias.id, alias.alias)}>Remove</button></span></div>)}</div>}</div> : null}
"""
replace_once("src/pages/AdminPage.tsx", old_table, new_table)

# Remove the temporary patch mechanism from the resulting branch tree.
Path("scripts/apply_course_alias_patch.py").unlink()
Path(".github/workflows/apply-course-alias-patch.yml").unlink()
