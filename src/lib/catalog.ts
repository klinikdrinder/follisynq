/**
 * Follisync clinical catalogue — single source of truth for the 12 procedural
 * stages, their media subcategories and their clinical parameter definitions.
 *
 * The same data is seeded into Supabase (scripts/gen-seed.ts). At runtime the
 * app prefers the organisation's definitions synced from Supabase (which
 * administrators can extend) and falls back to this bundled copy offline.
 *
 * Every parameter is OPTIONAL. Nothing here is ever required to record media.
 */

export type ParamType =
  | 'number' | 'text' | 'textarea' | 'select' | 'multiselect'
  | 'time' | 'datetime' | 'date' | 'boolean' | 'donor_region' | 'recipient_region'
  | 'donor_regions' | 'recipient_regions';

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  group?: string;
  unit?: string;
  options?: string[];
  /** show measurement-provenance selector (measured / estimated / …) */
  provenance?: boolean;
  /** promoted to typed parameter_values for library filtering */
  searchable?: boolean;
  help?: string;
}

export interface SubcategoryDef { code: string; label: string; folder: string }
export interface StageDef {
  code: string; // S01..S12
  number: number;
  slug: string;
  title: string;
  description: string;
  folder: string;
  priority: 'standard' | 'high' | 'highest';
  subcategories: SubcategoryDef[];
  params: ParamDef[];
  views?: string[];
}

const slugCode = (label: string) =>
  label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
const folderOf = (label: string) =>
  label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');

function subs(list: (string | [string, string])[]): SubcategoryDef[] {
  return list.map((s) => {
    const [label, code] = Array.isArray(s) ? s : [s, slugCode(s)];
    return { code, label, folder: folderOf(label) };
  });
}

// helpers for terse parameter declarations
const n = (key: string, label: string, unit?: string, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, type: 'number', unit, provenance: true, ...extra });
const t = (key: string, label: string, extra: Partial<ParamDef> = {}): ParamDef => ({ key, label, type: 'text', ...extra });
const ta = (key: string, label: string, extra: Partial<ParamDef> = {}): ParamDef => ({ key, label, type: 'textarea', ...extra });
const s = (key: string, label: string, options: string[], extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, type: 'select', options, ...extra });
const ms = (key: string, label: string, options: string[], extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, type: 'multiselect', options, ...extra });
const tm = (key: string, label: string, extra: Partial<ParamDef> = {}): ParamDef => ({ key, label, type: 'datetime', ...extra });
const c = (key: string, label: string, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, type: 'number', unit: 'count', ...extra });

export const DONOR_REGIONS = [
  'Central occipital', 'Upper occipital', 'Lower occipital', 'Left occipital', 'Right occipital',
  'Left parietal', 'Right parietal', 'Retroauricular', 'Beard', 'Chest', 'Other body donor region', 'Other', 'Not recorded',
];
export const RECIPIENT_REGIONS = [
  'Frontal hairline', 'Central frontal', 'Left frontal', 'Right frontal', 'Left temporal point', 'Right temporal point',
  'Mid-scalp', 'Crown or vertex', 'Transition zone', 'Scar region', 'Eyebrow', 'Beard', 'Other', 'Not recorded',
];

export const CLASSIFICATIONS: Record<string, string[]> = {
  'Hamilton–Norwood': ['I', 'II', 'IIa', 'III', 'IIIa', 'III vertex', 'IV', 'IVa', 'V', 'Va', 'VI', 'VII'],
  Ludwig: ['I', 'II', 'III'],
  Sinclair: ['1', '2', '3', '4', '5'],
  Other: [],
  'Unclassified / not recorded': [],
};

export const ETHNICITY_OPTIONS = [
  'Malay', 'Chinese', 'Indian', 'Other Southeast Asian', 'East Asian', 'South Asian', 'Middle Eastern',
  'European', 'African', 'Mixed ethnicity', 'Other or self-described', 'Prefer not to disclose', 'Not recorded',
];

export const PROVENANCE = [
  { v: 'measured', l: 'Measured' },
  { v: 'instrument', l: 'Instrument-reported' },
  { v: 'estimated', l: 'Clinician-estimated' },
  { v: 'observed', l: 'Clinician-observed' },
  { v: 'not_measured', l: 'Not measured' },
  { v: 'not_recorded', l: 'Not recorded' },
  { v: 'na', l: 'Not applicable' },
] as const;

const CALIBER = ['Fine', 'Medium', 'Coarse'];
const CURVATURE = ['Straight', 'Slight curl', 'Moderate curl', 'Strong curl', 'Not assessed'];
const LEVEL = ['Low', 'Moderate', 'High', 'Not assessed'];
const SEVERITY = ['None', 'Minimal', 'Mild', 'Moderate', 'Severe'];
const TISSUE_RES = ['Low', 'Normal', 'High', 'Very high'];
const ANGLE_AXIS = ['Scalp surface', 'Hair shaft', 'Vertical', 'Other'];

export const FOLLOW_UP_INTERVALS = [
  'Day 1', 'Day 3', 'Day 7', 'Day 10', 'Day 14', 'Month 1', 'Month 3', 'Month 6', 'Month 9', 'Month 12', 'Month 18', 'Custom',
];

export const BASELINE_VIEWS = [
  'Frontal', 'Left profile', 'Right profile', 'Top', 'Crown', 'Posterior', 'Left temporal', 'Right temporal', 'Close-up',
];

export const STAGES: StageDef[] = [
  {
    code: 'S01', number: 1, slug: 'consultation', title: 'Consultation and Diagnosis', folder: '01_Consultation', priority: 'standard',
    description: 'Consultation, history, hair-loss assessment, treatment planning and standardized baseline photography.',
    subcategories: subs(['Patient consultation', 'Medical history discussion', 'Hair loss assessment', 'Treatment planning',
      'Patient expectations', ['Preoperative baseline photography', 'BASELINE']]),
    views: BASELINE_VIEWS,
    params: [
      t('diagnosis', 'Diagnosis'),
      s('classification', 'Hair loss classification', Object.keys(CLASSIFICATIONS), { searchable: true }),
      t('grade', 'Hair loss grade', { searchable: true, help: 'Options follow the selected classification' }),
      t('duration', 'Hair loss duration'), t('progression', 'Progression pattern'),
      ta('previous_treatments', 'Previous treatments'), ta('previous_transplantations', 'Previous transplantations'),
      ta('expectations', 'Patient expectations'),
      s('donor_suitability', 'Donor suitability', ['Excellent', 'Good', 'Fair', 'Poor', 'Not assessed']),
      s('recipient_suitability', 'Recipient suitability', ['Excellent', 'Good', 'Fair', 'Poor', 'Not assessed']),
      ta('proposed_treatment', 'Proposed treatment'),
      c('planned_graft_count', 'Planned graft count', { provenance: true }),
      ta('observations', 'Clinical observations'),
    ],
  },
  {
    code: 'S02', number: 2, slug: 'donor-assessment', title: 'Donor Assessment', folder: '02_Donor_Assessment', priority: 'standard',
    description: 'Donor region evaluation including density, calibre, trichoscopy and mapping. Record each donor region separately.',
    subcategories: subs(['General donor assessment', 'Occipital donor assessment', 'Left parietal assessment', 'Right parietal assessment',
      'Trichoscopy', 'Follicular examination', 'Donor mapping', 'Previous scar assessment']),
    params: [
      { key: 'donor_region', label: 'Anatomical donor region', type: 'donor_region', searchable: true },
      t('donor_dimensions', 'Donor area dimensions', { help: 'e.g. 14 × 6 cm' }),
      n('fu_density', 'Follicular unit density', 'FU/cm²', { searchable: true }),
      n('hair_density', 'Hair density', 'hairs/cm²', { searchable: true }),
      n('shaft_diameter', 'Hair shaft diameter', 'µm', { searchable: true }),
      s('caliber', 'Hair caliber', CALIBER, { searchable: true }),
      s('curvature', 'Follicular curvature', CURVATURE), n('exit_angle', 'Hair exit angle', '°'),
      t('growth_direction', 'Hair growth direction'), n('hairs_per_fu', 'Hairs per follicular unit', 'hairs/FU'),
      n('miniaturization', 'Miniaturization', '%'),
      s('donor_quality', 'Donor quality', ['Excellent', 'Good', 'Fair', 'Poor']),
      s('scalp_thickness', 'Scalp thickness', ['Thin', 'Normal', 'Thick']),
      s('scalp_elasticity', 'Scalp elasticity', LEVEL), s('scalp_laxity', 'Scalp laxity', LEVEL),
      s('fibrosis', 'Existing fibrosis', SEVERITY), t('previous_scarring', 'Previous scarring'),
      s('donor_depletion', 'Donor depletion', SEVERITY),
      c('estimated_available_grafts', 'Estimated available grafts', { provenance: true }),
      t('instrument', 'Assessment instrument'), t('measurement_method', 'Measurement method'),
    ],
  },
  {
    code: 'S03', number: 3, slug: 'hairline-design', title: 'Hairline Design and Recipient Planning', folder: '03_Hairline_Design', priority: 'standard',
    description: 'Hairline marking, temporal point design and recipient area mapping through to the final approved design.',
    subcategories: subs(['Initial hairline marking', 'Hairline drawing', 'Hairline adjustment', 'Temporal point design',
      'Recipient area mapping', ['Final approved hairline', 'FINAL_HAIRLINE']]),
    params: [
      s('design_type', 'Hairline design type', ['Natural/irregular', 'Conservative', 'Juvenile', 'Mature', 'Feminine', 'Other']),
      n('hairline_height', 'Hairline height', 'cm'), n('hairline_width', 'Hairline width', 'cm'),
      s('hairline_shape', 'Hairline shape', ['Rounded', 'Flat', 'M-shaped', 'V-shaped (widow’s peak)', 'Bell-shaped', 'Other']),
      t('temporal_points', 'Temporal point design'),
      { key: 'recipient_regions', label: 'Recipient region', type: 'recipient_regions', searchable: true },
      n('recipient_area', 'Recipient surface area', 'cm²'), n('existing_density', 'Existing hair density', 'hairs/cm²'),
      n('planned_density', 'Planned graft density', 'grafts/cm²'), ta('planned_distribution', 'Planned graft distribution'),
      c('planned_single', 'Planned single-hair graft allocation'), c('planned_multi', 'Planned multiple-hair graft allocation'),
      ta('landmarks', 'Anatomical landmarks'), ta('revisions', 'Design revisions'), ta('observations', 'Clinical observations'),
    ],
  },
  {
    code: 'S04', number: 4, slug: 'preop-preparation', title: 'Preoperative Preparation', folder: '04_Preoperative_Preparation', priority: 'standard',
    description: 'Shaving, marking, cleansing, positioning and sterile preparation before anaesthesia.',
    subcategories: subs(['Preoperative photography', 'Hair shaving', 'Hair trimming', 'Donor marking', 'Recipient marking',
      'Scalp cleansing', 'Patient positioning', 'Sterile preparation']),
    params: [
      s('shaving_technique', 'Shaving technique', ['Fully shaven', 'Partially shaven', 'Unshaven', 'Strip shave', 'Other']),
      n('remaining_length', 'Remaining hair length', 'mm'), t('prep_method', 'Preparation method'),
      t('prep_products', 'Preparation products'),
      { key: 'donor_prepared', label: 'Donor area prepared', type: 'donor_regions' },
      { key: 'recipient_prepared', label: 'Recipient area prepared', type: 'recipient_regions' },
      s('patient_position', 'Patient position', ['Supine', 'Prone', 'Semi-recumbent', 'Sitting', 'Lateral', 'Other']),
      t('baseline_scalp', 'Baseline scalp condition'),
      tm('prep_start', 'Preparation start'), tm('prep_end', 'Preparation end'),
      ta('observations', 'Clinical observations'),
    ],
  },
  {
    code: 'S05', number: 5, slug: 'anaesthesia', title: 'Anaesthesia and Tumescence', folder: '05_Anaesthesia_Tumescence', priority: 'standard',
    description: 'Record clinician-entered anaesthesia information only. Follisync never calculates, recommends or prescribes doses.',
    subcategories: subs(['Donor anaesthesia', 'Recipient anaesthesia', 'Nerve block', 'Local infiltration', 'Donor tumescence',
      'Recipient tumescence', ['Additional anaesthesia rounds', 'ADDITIONAL_ROUND']]),
    params: [
      t('agent', 'Anaesthetic agent'), t('concentration', 'Agent concentration'),
      t('dose', 'Recorded administered dose', { help: 'As entered by clinician — not calculated' }),
      n('volume', 'Administered volume', 'mL'), ta('solution', 'Solution composition'),
      t('injection_instrument', 'Injection instrument'), t('needle_gauge', 'Needle gauge', { help: 'e.g. 30G' }),
      t('region', 'Anatomical region'), n('round', 'Administration round', undefined, { provenance: false }),
      tm('administered_at', 'Administration timestamp'),
      s('patient_position', 'Patient position', ['Supine', 'Prone', 'Semi-recumbent', 'Sitting', 'Lateral', 'Other']),
      t('tissue_response', 'Observed tissue response'), t('bleeding', 'Bleeding observations'),
      t('patient_response', 'Patient response'), ta('notes', 'Additional clinical notes'),
    ],
  },
  {
    code: 'S06', number: 6, slug: 'fue-harvesting', title: 'FUE Harvesting', folder: '06_FUE_Harvesting', priority: 'highest',
    description: 'Punching and forceps extraction. Parameter changes create a new version; later recordings inherit them while earlier recordings keep their snapshot.',
    subcategories: subs([['Punch preparation', 'PUNCH_PREP'], ['Initial punching', 'PUNCHING_INITIAL'], ['Continuous punching', 'PUNCHING'],
      ['Individual follicular punching', 'PUNCHING_INDIVIDUAL'], ['Punch-angle demonstration', 'PUNCH_ANGLE'],
      ['Graft extraction using forceps', 'EXTRACTION'], ['Difficult graft extraction', 'EXTRACTION_DIFFICULT'],
      ['Curved follicle extraction', 'EXTRACTION_CURVED'], ['Donor region transition', 'REGION_TRANSITION'],
      ['Punch instrument change', 'INSTRUMENT_CHANGE'], ['Harvested donor inspection', 'DONOR_INSPECTION'],
      ['Instrument cleaning', 'INSTRUMENT_CLEANING']]),
    params: [
      t('punch_manufacturer', 'Punch manufacturer', { group: 'Punch & instruments', searchable: true }),
      t('punch_model', 'Punch model', { group: 'Punch & instruments', searchable: true }),
      n('punch_diameter', 'Punch diameter', 'mm', { group: 'Punch & instruments', searchable: true }),
      s('punch_geometry', 'Punch geometry', ['Flat', 'Trumpet', 'Serrated', 'Hybrid', 'Flared', 'Other'], { group: 'Punch & instruments' }),
      s('punch_type', 'Punch type', ['Sharp', 'Blunt', 'Hybrid', 'Other'], { group: 'Punch & instruments', searchable: true }),
      t('punch_edge', 'Punch edge characteristics', { group: 'Punch & instruments' }),
      n('punch_depth', 'Punch depth', 'mm', { group: 'Punch & instruments' }),
      n('punch_angle', 'Punch angle', '°', { group: 'Punch & instruments' }),
      s('angle_axis', 'Angle reference axis', ANGLE_AXIS, { group: 'Punch & instruments' }),
      t('punch_orientation', 'Punch orientation', { group: 'Punch & instruments' }),
      t('punch_material', 'Punch material', { group: 'Punch & instruments' }),
      t('motor_manufacturer', 'Motor manufacturer', { group: 'Punch & instruments', searchable: true }),
      t('motor_model', 'Motor model', { group: 'Punch & instruments', searchable: true }),
      n('rpm', 'RPM', 'rpm', { group: 'Punch & instruments', searchable: true }),
      t('motor_mode', 'Motor mode', { group: 'Punch & instruments' }),
      s('rotation', 'Rotation or oscillation', ['Rotation', 'Oscillation', 'Hybrid', 'Manual'], { group: 'Punch & instruments' }),
      n('oscillation_angle', 'Oscillation angle', '°', { group: 'Punch & instruments' }),
      t('torque', 'Torque setting', { group: 'Punch & instruments' }),
      t('suction', 'Suction setting', { group: 'Punch & instruments' }),
      t('forceps_type', 'Extraction forceps type', { group: 'Punch & instruments' }),
      t('forceps_model', 'Extraction forceps model', { group: 'Punch & instruments' }),
      t('forceps_tip', 'Forceps tip size', { group: 'Punch & instruments' }),
      { key: 'donor_region', label: 'Donor region', type: 'donor_region', group: 'Anatomy', searchable: true },
      t('donor_subregion', 'Donor subregion', { group: 'Anatomy' }),
      s('laterality', 'Left / right / central', ['Left', 'Right', 'Central', 'Bilateral'], { group: 'Anatomy' }),
      t('growth_direction', 'Hair growth direction', { group: 'Anatomy' }),
      n('exit_angle', 'Hair exit angle', '°', { group: 'Anatomy' }),
      s('curvature', 'Follicular curvature', CURVATURE, { group: 'Anatomy' }),
      s('caliber', 'Hair caliber', CALIBER, { group: 'Anatomy' }),
      s('tissue_resistance', 'Tissue resistance', TISSUE_RES, { group: 'Anatomy' }),
      s('scalp_thickness', 'Scalp thickness', ['Thin', 'Normal', 'Thick'], { group: 'Anatomy' }),
      t('tissue_condition', 'Tissue condition', { group: 'Anatomy' }),
      s('fibrosis', 'Existing fibrosis', SEVERITY, { group: 'Anatomy' }),
      c('punch_attempts', 'Punch attempts', { group: 'Performance' }),
      c('successful_extractions', 'Successful extractions', { group: 'Performance' }),
      c('extracted_grafts', 'Extracted graft count', { group: 'Performance' }),
      c('transected', 'Transected graft count', { group: 'Performance' }),
      c('partial_transection', 'Partial transection count', { group: 'Performance' }),
      c('complete_transection', 'Complete transection count', { group: 'Performance' }),
      c('buried', 'Buried grafts', { group: 'Performance' }), c('missing', 'Missing grafts', { group: 'Performance' }),
      c('damaged', 'Damaged grafts', { group: 'Performance' }),
      c('failed_attempts', 'Failed extraction attempts', { group: 'Performance' }),
      tm('start', 'Harvesting start time', { group: 'Performance' }), tm('end', 'Harvesting end time', { group: 'Performance' }),
      n('duration_min', 'Harvesting duration', 'min', { group: 'Performance' }),
      n('extraction_rate', 'Extraction rate', 'grafts/h', { group: 'Performance' }),
      n('transection_rate', 'Recorded transection rate', '%', { group: 'Performance' }),
      t('transection_sampling', 'Transection sampling method and denominator', { group: 'Performance' }),
      t('bleeding', 'Bleeding observations', { group: 'Performance' }),
      c('instrument_changes', 'Instrument changes', { group: 'Performance' }),
      t('instrument_change_reason', 'Reason for instrument changes', { group: 'Performance' }),
      ta('complications', 'Clinical complications', { group: 'Performance' }),
      ta('operator_notes', 'Operator notes', { group: 'Performance' }),
    ],
  },
  {
    code: 'S07', number: 7, slug: 'graft-handling', title: 'Graft Handling, Inspection and Preservation', folder: '07_Graft_Handling', priority: 'high',
    description: 'Inspection, sorting, counting and preservation of grafts. Media can be linked to individual graft batches.',
    subcategories: subs(['Newly extracted grafts', 'Microscopic inspection', 'Graft classification', 'Graft sorting', 'Graft trimming',
      'Graft counting', 'Graft hydration', 'Graft preservation', 'Damaged graft inspection', 'Graft batch preparation']),
    params: [
      { key: 'donor_region', label: 'Donor region of origin', type: 'donor_region' },
      tm('extracted_at', 'Extraction timestamp'),
      c('g1', 'Single-hair graft count', { searchable: true }), c('g2', 'Double-hair graft count'), c('g3', 'Triple-hair graft count'),
      c('g4', 'Four-or-more-hair graft count'), c('total_grafts', 'Total graft count'), c('total_hairs', 'Total hair count'),
      n('graft_length', 'Graft length', 'mm'), t('graft_thickness', 'Graft thickness'),
      s('curvature', 'Follicular curvature', CURVATURE),
      c('intact', 'Intact graft count'), c('partially_damaged', 'Partially damaged graft count'),
      c('completely_damaged', 'Completely damaged graft count'), c('transected', 'Transected graft count'),
      c('crushed', 'Crushed graft count'), c('capped', 'Capped graft count'), ta('other_abnormalities', 'Other graft abnormalities'),
      t('storage_solution', 'Storage solution'), n('storage_temp', 'Storage temperature', '°C'),
      t('hydration_method', 'Hydration method'), tm('preservation_start', 'Preservation start time'),
      n('out_of_body', 'Out-of-body duration', 'min'), t('magnification', 'Magnification used'),
      t('inspection_instrument', 'Inspection instrument'), t('handling_instrument', 'Handling instrument'),
      ta('observations', 'Clinical observations'),
    ],
  },
  {
    code: 'S08', number: 8, slug: 'slit-making', title: 'Recipient-Site Creation / Slit-Making', folder: '08_Slit_Making', priority: 'highest',
    description: 'Recipient-site creation with blades or needles across hairline, frontal, mid-scalp, crown and temporal regions.',
    subcategories: subs(['Recipient marking', 'Initial slit creation', ['Continuous slit-making', 'SLITMAKING'], ['Hairline slit-making', 'SLIT_HAIRLINE'],
      ['Frontal slit-making', 'SLIT_FRONTAL'], ['Mid-scalp slit-making', 'SLIT_MIDSCALP'], ['Crown slit-making', 'SLIT_CROWN'],
      ['Temporal slit-making', 'SLIT_TEMPORAL'], ['Slit-angle demonstration', 'SLIT_ANGLE'], ['Slit-direction demonstration', 'SLIT_DIRECTION'],
      'Instrument change', ['Completed recipient-site inspection', 'SITE_INSPECTION']]),
    params: [
      t('manufacturer', 'Blade or needle manufacturer', { group: 'Instrument', searchable: true }),
      t('model', 'Instrument model', { group: 'Instrument', searchable: true }),
      s('instrument_type', 'Instrument type', ['Sapphire blade', 'Steel blade', 'Needle', 'Custom-cut blade', 'Implanter (DHI)', 'Other'], { group: 'Instrument', searchable: true }),
      t('blade_shape', 'Blade shape', { group: 'Instrument' }), t('blade_material', 'Blade material', { group: 'Instrument' }),
      n('blade_width', 'Blade width', 'mm', { group: 'Instrument', searchable: true }),
      t('needle_gauge', 'Needle gauge', { group: 'Instrument' }),
      n('slit_width', 'Slit width', 'mm', { group: 'Slit' }), n('slit_depth', 'Slit depth', 'mm', { group: 'Slit' }),
      n('slit_angle', 'Slit angle', '°', { group: 'Slit' }), s('angle_axis', 'Angle reference axis', ANGLE_AXIS, { group: 'Slit' }),
      t('slit_direction', 'Slit direction', { group: 'Slit' }), t('slit_orientation', 'Slit orientation', { group: 'Slit' }),
      s('approach', 'Coronal or sagittal approach', ['Coronal', 'Sagittal', 'Mixed'], { group: 'Slit', searchable: true }),
      { key: 'recipient_region', label: 'Recipient anatomical region', type: 'recipient_region', group: 'Anatomy', searchable: true },
      t('recipient_subregion', 'Recipient subregion', { group: 'Anatomy' }),
      n('recipient_area', 'Recipient surface area', 'cm²', { group: 'Anatomy' }),
      n('existing_density', 'Existing hair density', 'hairs/cm²', { group: 'Anatomy' }),
      n('planned_site_density', 'Planned site density', 'sites/cm²', { group: 'Anatomy' }),
      n('actual_site_density', 'Actual site density', 'sites/cm²', { group: 'Anatomy' }),
      c('sites_created', 'Number of sites created', { group: 'Performance' }),
      t('site_spacing', 'Site spacing', { group: 'Performance' }),
      t('growth_direction', 'Hair growth direction', { group: 'Anatomy' }),
      t('existing_hair_interference', 'Existing hair interference', { group: 'Anatomy' }),
      s('tissue_resistance', 'Tissue resistance', TISSUE_RES, { group: 'Anatomy' }),
      t('tissue_response', 'Tissue response', { group: 'Performance' }), t('bleeding', 'Bleeding observations', { group: 'Performance' }),
      c('instrument_changes', 'Instrument changes', { group: 'Performance' }),
      n('duration_min', 'Slit creation duration', 'min', { group: 'Performance' }),
      ta('operator_observations', 'Operator observations', { group: 'Performance' }),
    ],
  },
  {
    code: 'S09', number: 9, slug: 'implantation', title: 'Graft Implantation', folder: '09_Implantation', priority: 'highest',
    description: 'Forceps or implanter placement of grafts by region, including popping and repositioning events.',
    subcategories: subs(['Graft loading', 'Implanter preparation', ['Forceps implantation', 'IMPLANTATION'], ['Implanter implantation', 'IMPLANTER'],
      ['Single-hair graft placement', 'PLACEMENT_SINGLE'], ['Multiple-hair graft placement', 'PLACEMENT_MULTI'],
      ['Hairline implantation', 'IMPLANT_HAIRLINE'], ['Frontal implantation', 'IMPLANT_FRONTAL'], ['Mid-scalp implantation', 'IMPLANT_MIDSCALP'],
      ['Crown implantation', 'IMPLANT_CROWN'], ['Difficult implantation', 'IMPLANT_DIFFICULT'], 'Graft repositioning', 'Graft popping',
      ['Final implanted region inspection', 'FINAL_INSPECTION']]),
    params: [
      s('technique', 'Implantation technique', ['Forceps (stick-and-place)', 'Forceps (pre-made sites)', 'Implanter (DHI/Choi)', 'Implanter (pre-made sites)', 'Mixed'], { group: 'Technique', searchable: true }),
      t('implanter_manufacturer', 'Implanter manufacturer', { group: 'Instrument' }),
      t('implanter_model', 'Implanter model', { group: 'Instrument' }),
      n('implanter_diameter', 'Implanter diameter', 'mm', { group: 'Instrument' }),
      t('needle_size', 'Needle size', { group: 'Instrument' }),
      t('forceps_type', 'Implantation forceps type', { group: 'Instrument' }),
      t('forceps_tip', 'Forceps tip characteristics', { group: 'Instrument' }),
      t('graft_batch_code', 'Graft batch ID', { group: 'Grafts' }),
      s('graft_type', 'Graft type', ['Single', 'Double', 'Triple', 'Four or more', 'Mixed'], { group: 'Grafts', searchable: true }),
      n('hairs_per_graft', 'Number of hairs per graft', 'hairs', { group: 'Grafts' }),
      n('graft_length', 'Graft length', 'mm', { group: 'Grafts' }),
      { key: 'recipient_region', label: 'Recipient region', type: 'recipient_region', group: 'Anatomy', searchable: true },
      t('recipient_subregion', 'Recipient subregion', { group: 'Anatomy' }),
      n('placement_angle', 'Placement angle', '°', { group: 'Anatomy' }),
      t('placement_direction', 'Placement direction', { group: 'Anatomy' }),
      n('placement_depth', 'Placement depth', 'mm', { group: 'Anatomy' }),
      c('implanted', 'Implantation count', { group: 'Performance' }), c('popping', 'Graft popping count', { group: 'Performance' }),
      c('reimplanted', 'Reimplantation count', { group: 'Performance' }), c('damaged', 'Damaged graft count', { group: 'Performance' }),
      c('failed_attempts', 'Failed placement attempts', { group: 'Performance' }),
      t('handling_observations', 'Graft handling observations', { group: 'Performance' }),
      n('out_of_body', 'Out-of-body duration', 'min', { group: 'Performance' }),
      t('tissue_response', 'Tissue response', { group: 'Performance' }),
      tm('start', 'Implantation start time', { group: 'Performance' }), tm('end', 'Implantation end time', { group: 'Performance' }),
      n('duration_min', 'Implantation duration', 'min', { group: 'Performance' }),
      n('implantation_rate', 'Implantation rate', 'grafts/h', { group: 'Performance' }),
      ta('operator_notes', 'Operator notes', { group: 'Performance' }),
    ],
  },
  {
    code: 'S10', number: 10, slug: 'final-assessment', title: 'Final Surgical Assessment', folder: '10_Final_Assessment', priority: 'standard',
    description: 'Final donor and recipient inspection, graft totals and standardized postoperative photographs.',
    subcategories: subs(['Final donor inspection', 'Final recipient inspection', 'Completed hairline', 'Completed frontal region',
      'Completed crown', 'Overall surgical result', ['Standardized postoperative photographs', 'POSTOP_STANDARD']]),
    views: BASELINE_VIEWS,
    params: [
      c('planned_grafts', 'Planned graft count'), c('harvested_grafts', 'Actual harvested graft count', { provenance: true }),
      c('implanted_grafts', 'Actual implanted graft count', { provenance: true }), c('unused_grafts', 'Unused graft count'),
      c('damaged_grafts', 'Damaged graft count'), c('transected_total', 'Total recorded transected grafts'),
      n('transection_rate', 'Recorded transection rate', '%'), c('single_grafts', 'Single-hair graft count'),
      c('multi_grafts', 'Multiple-hair graft count'), ta('regional_distribution', 'Regional graft distribution'),
      n('achieved_density', 'Achieved recipient density', 'grafts/cm²'), t('donor_condition', 'Donor condition'),
      t('recipient_condition', 'Recipient condition'), s('bleeding', 'Bleeding', SEVERITY), s('swelling', 'Swelling', SEVERITY),
      ta('complications', 'Surgical complications'), ta('observations', 'Final clinical observations'),
      n('total_duration_min', 'Total surgical duration', 'min'),
    ],
  },
  {
    code: 'S11', number: 11, slug: 'postop-care', title: 'Dressing and Postoperative Care', folder: '11_Postoperative_Care', priority: 'standard',
    description: 'Cleaning, dressing, postoperative treatment, instructions and discharge.',
    subcategories: subs(['Donor cleaning', 'Recipient cleaning', 'Dressing preparation', 'Bandaging', 'Postoperative treatment',
      'Postoperative instructions', ['Patient discharge documentation', 'DISCHARGE']]),
    params: [
      t('dressing_method', 'Dressing method'), t('dressing_material', 'Dressing material'), t('donor_condition', 'Donor condition'),
      t('recipient_condition', 'Recipient condition'), s('bleeding', 'Postoperative bleeding', SEVERITY), s('swelling', 'Swelling', SEVERITY),
      ta('treatments', 'Treatments administered'), ta('medications', 'Recorded medications'),
      ta('instructions', 'Postoperative instructions'), t('patient_response', 'Patient response'), ta('complications', 'Complications'),
      tm('discharge_time', 'Discharge time'), { key: 'follow_up_date', label: 'Follow-up appointment date', type: 'date' },
      ta('notes', 'Clinical notes'),
    ],
  },
  {
    code: 'S12', number: 12, slug: 'follow-up', title: 'Follow-up and Longitudinal Outcomes', folder: '12_Follow_Up', priority: 'standard',
    description: 'Longitudinal follow-up encounters. Suggested intervals are never enforced. Use standardized views matching baseline.',
    subcategories: subs(['Donor healing', 'Recipient healing', 'Scab formation', 'Scab removal', 'Redness', 'Swelling', 'Shedding',
      'Early hair growth', 'Progressive hair growth', 'Final outcome', 'Trichoscopy', ['Before-and-after documentation', 'BEFORE_AFTER']]),
    views: BASELINE_VIEWS,
    params: [
      { key: 'follow_up_date', label: 'Follow-up date', type: 'date' },
      s('donor_healing', 'Donor healing status', ['Excellent', 'Good', 'Delayed', 'Complicated']),
      s('recipient_healing', 'Recipient healing status', ['Excellent', 'Good', 'Delayed', 'Complicated']),
      s('redness', 'Redness', SEVERITY), s('swelling', 'Swelling', SEVERITY), t('scarring', 'Scarring'),
      t('infection', 'Infection observations'), s('shedding', 'Shedding', SEVERITY), s('shock_loss', 'Shock loss', SEVERITY),
      ta('growth_observations', 'Hair growth observations'), n('measured_density', 'Measured hair density', 'hairs/cm²'),
      n('measured_caliber', 'Measured hair caliber', 'µm'), n('graft_survival', 'Graft survival estimate', '%'),
      t('measurement_method', 'Measurement methodology'),
      s('satisfaction', 'Patient satisfaction', ['Very satisfied', 'Satisfied', 'Neutral', 'Dissatisfied', 'Very dissatisfied']),
      ta('additional_treatments', 'Additional treatments'), ta('complications', 'Complications'), ta('notes', 'Clinical notes'),
    ],
  },
];

/** Patient-level profile sections (clinical history, hair, scalp). */
export const PATIENT_SECTIONS: { key: 'clinical_history' | 'hair' | 'scalp'; title: string; params: ParamDef[] }[] = [
  {
    key: 'clinical_history', title: 'Clinical history',
    params: [
      t('primary_diagnosis', 'Primary hair loss diagnosis'), t('duration', 'Hair loss duration'), t('progression', 'Hair loss progression'),
      s('family_history', 'Family history of hair loss', ['Yes – paternal', 'Yes – maternal', 'Yes – both', 'No', 'Unknown']),
      s('previous_transplant', 'Previous hair transplantation', ['Yes', 'No', 'Unknown']),
      c('previous_transplant_count', 'Number of previous transplantations'), t('previous_transplant_dates', 'Previous transplantation dates'),
      c('previous_graft_count', 'Previously transplanted graft count'), ta('previous_treatments', 'Previous hair loss treatments'),
      ta('current_medications', 'Current medications'), ta('previous_medications', 'Previous medications'),
      ta('medical_conditions', 'Relevant medical conditions'), ta('allergies', 'Allergies'),
      ta('previous_scalp_procedures', 'Previous scalp procedures'), t('existing_scars', 'Existing scalp scars'),
      s('smoking', 'Smoking history', ['Never', 'Former', 'Current', 'Not recorded']), ta('observations', 'Relevant clinical observations'),
    ],
  },
  {
    key: 'hair', title: 'Hair and follicular characteristics',
    params: [
      t('hair_color', 'Hair color'), t('natural_hair_color', 'Natural hair color'),
      s('texture', 'Hair texture', ['Straight', 'Wavy', 'Curly', 'Coily'], { searchable: true }),
      s('caliber', 'Hair caliber', CALIBER, { searchable: true }), n('shaft_diameter', 'Measured hair shaft diameter', 'µm'),
      s('contrast', 'Hair-to-scalp color contrast', ['Low', 'Medium', 'High']), s('curvature', 'Follicular curvature', CURVATURE),
      n('exit_angle', 'Hair exit angle', '°'), t('growth_direction', 'Hair growth direction'),
      n('hairs_per_fu', 'Average hairs per follicular unit', 'hairs/FU'), n('hair_length', 'Hair length', 'cm'),
      n('hair_density', 'Hair density', 'hairs/cm²'), n('fu_density', 'Follicular unit density', 'FU/cm²'),
      n('miniaturization', 'Miniaturization', '%'),
    ],
  },
  {
    key: 'scalp', title: 'Scalp characteristics',
    params: [
      s('fitzpatrick', 'Skin phototype (Fitzpatrick)', ['I', 'II', 'III', 'IV', 'V', 'VI', 'Not assessed']),
      t('pigmentation', 'Scalp pigmentation'), s('thickness', 'Scalp thickness', ['Thin', 'Normal', 'Thick']),
      s('elasticity', 'Scalp elasticity', LEVEL), s('laxity', 'Scalp laxity', LEVEL), t('condition', 'Scalp condition'),
      t('sensitivity', 'Scalp sensitivity'), s('fibrosis', 'Existing fibrosis', SEVERITY), t('scar_tissue', 'Existing scar tissue'),
      s('donor_depletion', 'Donor depletion', SEVERITY), ta('abnormalities', 'Relevant scalp abnormalities'),
    ],
  },
];

export const RECORDING_CONTEXT: ParamDef[] = [
  s('shot', 'Overview / close-up', ['Overview', 'Close-up']),
  s('capture_mode', 'Capture mode', ['Standard', 'Macro', 'Microscope']),
  s('pov', 'Point of view', ['Surgeon POV', 'Assistant POV', 'Fixed / tripod', 'Other']),
  n('camera_distance', 'Camera distance', 'cm', { provenance: false }),
  t('optical_magnification', 'Optical magnification'), t('camera_zoom', 'Camera zoom'),
  s('lighting', 'Lighting conditions', ['Surgical light', 'Ambient', 'Ring light', 'Mixed', 'Low light']),
  t('recording_angle', 'Recording angle'), s('narration', 'Narration', ['None', 'Clinical narration', 'Ambient conversation']),
  tm('clinical_event_at', 'Clinical event timestamp'),
];

export const stageByCode = (code: string) => STAGES.find((x) => x.code === code);
export const stageBySlug = (slug: string) => STAGES.find((x) => x.slug === slug);
