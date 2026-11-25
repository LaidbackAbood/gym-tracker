// Exercise library + default 5-day rotation.
// muscle: used for weekly set counts. group: exercises in the same group are offered as swaps first.
// inc: suggested weight jump in kg. reps: target range. sets: default sets.
window.GYM_DATA = (function () {
  const E = (name, muscle, group, equip, opts = {}) => ({
    name, muscle, group, equip,
    inc: opts.inc ?? (equip === 'dumbbell' ? 2 : 2.5),
    reps: opts.reps ?? [8, 12],
    sets: opts.sets ?? 3,
    bodyweight: !!opts.bw,
  });

  const exercises = {
    // ---- Chest: flat press
    machine_chest_press: E('Machine chest press', 'chest', 'chest-press', 'machine', { reps: [6, 10], sets: 4 }),
    smith_flat_press: E('Smith machine flat press', 'chest', 'chest-press', 'smith', { reps: [6, 10] }),
    plate_chest_press: E('Plate-loaded chest press', 'chest', 'chest-press', 'machine', { reps: [6, 10] }),
    cable_chest_press: E('Cable standing chest press', 'chest', 'chest-press', 'cable'),
    db_bench: E('Dumbbell bench press', 'chest', 'chest-press', 'dumbbell', { reps: [6, 10] }),
    bb_bench: E('Barbell bench press', 'chest', 'chest-press', 'barbell', { reps: [5, 8] }),
    // ---- Chest: incline
    incline_smith: E('Incline Smith press', 'chest', 'incline-press', 'smith', { reps: [6, 10] }),
    incline_machine: E('Incline chest press machine', 'chest', 'incline-press', 'machine', { reps: [6, 10] }),
    incline_plate: E('Plate-loaded incline press', 'chest', 'incline-press', 'machine', { reps: [6, 10] }),
    incline_db: E('Incline dumbbell press', 'chest', 'incline-press', 'dumbbell', { reps: [6, 10] }),
    // ---- Chest: fly
    pec_deck: E('Pec deck', 'chest', 'chest-fly', 'machine', { reps: [10, 15] }),
    cable_fly_mid: E('Cable crossover', 'chest', 'chest-fly', 'cable', { reps: [10, 15] }),
    cable_fly_low: E('Low-to-high cable fly', 'chest', 'chest-fly', 'cable', { reps: [10, 15] }),
    cable_fly_high: E('High-to-low cable fly', 'chest', 'chest-fly', 'cable', { reps: [10, 15] }),
    db_fly: E('Dumbbell fly', 'chest', 'chest-fly', 'dumbbell', { reps: [10, 15] }),
    // ---- Shoulders: press
    machine_shoulder_press: E('Machine shoulder press', 'shoulders', 'shoulder-press', 'machine', { reps: [6, 10] }),
    smith_shoulder_press: E('Smith shoulder press', 'shoulders', 'shoulder-press', 'smith', { reps: [6, 10] }),
    plate_shoulder_press: E('Plate-loaded shoulder press', 'shoulders', 'shoulder-press', 'machine', { reps: [6, 10] }),
    db_shoulder_press: E('Dumbbell shoulder press', 'shoulders', 'shoulder-press', 'dumbbell', { reps: [6, 10] }),
    // ---- Shoulders: lateral
    cable_lateral: E('Cable lateral raise', 'shoulders', 'lateral', 'cable', { reps: [12, 20], inc: 1.25 }),
    machine_lateral: E('Machine lateral raise', 'shoulders', 'lateral', 'machine', { reps: [12, 20] }),
    db_lateral: E('Dumbbell lateral raise', 'shoulders', 'lateral', 'dumbbell', { reps: [12, 20], inc: 1 }),
    // ---- Rear delts
    reverse_pec_deck: E('Reverse pec deck', 'shoulders', 'rear-delt', 'machine', { reps: [12, 20] }),
    face_pull: E('Face pull', 'shoulders', 'rear-delt', 'cable', { reps: [12, 20] }),
    cable_rear_fly: E('Cable rear delt fly', 'shoulders', 'rear-delt', 'cable', { reps: [12, 20], inc: 1.25 }),
    db_rear_fly: E('Dumbbell rear delt fly', 'shoulders', 'rear-delt', 'dumbbell', { reps: [12, 20], inc: 1 }),
    // ---- Triceps
    pushdown_rope: E('Cable triceps pushdown', 'triceps', 'triceps-push', 'cable', { reps: [10, 15] }),
    pushdown_bar: E('Straight-bar pushdown', 'triceps', 'triceps-push', 'cable', { reps: [10, 15] }),
    dip_machine: E('Seated dip machine', 'triceps', 'triceps-push', 'machine', { reps: [8, 12] }),
    triceps_machine: E('Triceps extension machine', 'triceps', 'triceps-push', 'machine', { reps: [10, 15] }),
    overhead_cable_ext: E('Overhead cable triceps extension', 'triceps', 'triceps-overhead', 'cable', { reps: [10, 15] }),
    db_overhead_ext: E('Dumbbell overhead extension', 'triceps', 'triceps-overhead', 'dumbbell', { reps: [10, 15] }),
    skull_crusher: E('EZ-bar skull crusher', 'triceps', 'triceps-overhead', 'barbell', { reps: [8, 12] }),
    // ---- Back: vertical pull
    lat_pulldown: E('Lat pulldown', 'back', 'vertical-pull', 'cable', { reps: [8, 12], sets: 4 }),
    close_pulldown: E('Close-grip pulldown', 'back', 'vertical-pull', 'cable', { reps: [8, 12] }),
    machine_pulldown: E('Plate-loaded pulldown', 'back', 'vertical-pull', 'machine', { reps: [8, 12] }),
    single_arm_pulldown: E('Single-arm cable pulldown', 'back', 'vertical-pull', 'cable', { reps: [10, 12] }),
    assisted_pullup: E('Assisted pull-up machine', 'back', 'vertical-pull', 'machine', { reps: [6, 12] }),
    pullup: E('Pull-up (add weight if any)', 'back', 'vertical-pull', 'bodyweight', { reps: [5, 10], bw: true }),
    // ---- Back: rows
    seated_cable_row: E('Seated cable row', 'back', 'row', 'cable', { reps: [8, 12] }),
    chest_supported_row: E('Chest-supported machine row', 'back', 'row', 'machine', { reps: [8, 12], sets: 4 }),
    tbar_row: E('T-bar row', 'back', 'row', 'machine', { reps: [6, 10] }),
    single_cable_row: E('Single-arm cable row', 'back', 'row', 'cable', { reps: [10, 12] }),
    db_row: E('Single-arm dumbbell row', 'back', 'row', 'dumbbell', { reps: [8, 12] }),
    bb_row: E('Barbell row', 'back', 'row', 'barbell', { reps: [6, 10] }),
    // ---- Back: high row
    machine_high_row: E('Machine high row', 'back', 'high-row', 'machine', { reps: [8, 12] }),
    kneeling_high_row: E('Kneeling cable high row', 'back', 'high-row', 'cable', { reps: [10, 12] }),
    // ---- Back: lat isolation
    straight_arm_pulldown: E('Straight-arm pulldown', 'back', 'lat-iso', 'cable', { reps: [10, 15] }),
    machine_pullover: E('Pullover machine', 'back', 'lat-iso', 'machine', { reps: [10, 15] }),
    db_pullover: E('Dumbbell pullover', 'back', 'lat-iso', 'dumbbell', { reps: [10, 15] }),
    // ---- Biceps
    cable_curl: E('Cable curl', 'biceps', 'curl', 'cable', { reps: [10, 15] }),
    preacher_machine: E('Preacher curl machine', 'biceps', 'curl', 'machine', { reps: [8, 12] }),
    bayesian_curl: E('Bayesian cable curl', 'biceps', 'curl', 'cable', { reps: [10, 15], inc: 1.25 }),
    ez_curl: E('EZ-bar curl', 'biceps', 'curl', 'barbell', { reps: [8, 12] }),
    db_curl: E('Dumbbell curl', 'biceps', 'curl', 'dumbbell', { reps: [8, 12] }),
    hammer_curl: E('Hammer curl', 'biceps', 'curl', 'dumbbell', { reps: [10, 12] }),
    // ---- Legs
    leg_press: E('Leg press', 'legs', 'squat', 'machine', { reps: [8, 12], sets: 4, inc: 5 }),
    hack_squat: E('Hack squat', 'legs', 'squat', 'machine', { reps: [6, 10], inc: 5 }),
    pendulum_squat: E('Pendulum squat', 'legs', 'squat', 'machine', { reps: [8, 12], inc: 5 }),
    smith_squat: E('Smith machine squat', 'legs', 'squat', 'smith', { reps: [6, 10], inc: 5 }),
    belt_squat: E('Belt squat', 'legs', 'squat', 'machine', { reps: [8, 12], inc: 5 }),
    bb_squat: E('Barbell back squat', 'legs', 'squat', 'barbell', { reps: [5, 8], inc: 5 }),
    leg_extension: E('Leg extension', 'legs', 'leg-ext', 'machine', { reps: [10, 15] }),
    single_leg_extension: E('Single-leg extension', 'legs', 'leg-ext', 'machine', { reps: [10, 15] }),
    seated_leg_curl: E('Seated leg curl', 'legs', 'leg-curl', 'machine', { reps: [10, 15] }),
    lying_leg_curl: E('Lying leg curl', 'legs', 'leg-curl', 'machine', { reps: [10, 15] }),
    standing_leg_curl: E('Standing single-leg curl', 'legs', 'leg-curl', 'machine', { reps: [10, 15] }),
    rdl: E('Romanian deadlift', 'legs', 'leg-curl', 'barbell', { reps: [6, 10], inc: 5 }),
    standing_calf: E('Standing calf raise machine', 'legs', 'calf', 'machine', { reps: [10, 15], sets: 4, inc: 5 }),
    seated_calf: E('Seated calf raise', 'legs', 'calf', 'machine', { reps: [12, 20] }),
    leg_press_calf: E('Calf press on leg press', 'legs', 'calf', 'machine', { reps: [12, 20], inc: 5 }),
    smith_calf: E('Smith machine calf raise', 'legs', 'calf', 'smith', { reps: [10, 15], inc: 5 }),
  };

  const days = [
    { id: 'pushA', name: 'Push A', type: 'push', focus: 'Chest focus',
      exercises: ['machine_chest_press', 'incline_smith', 'pec_deck', 'machine_shoulder_press', 'pushdown_rope'] },
    { id: 'pullA', name: 'Pull A', type: 'pull', focus: 'Back width',
      exercises: ['lat_pulldown', 'seated_cable_row', 'machine_high_row', 'reverse_pec_deck', 'cable_curl'] },
    { id: 'legs', name: 'Legs', type: 'legs', focus: 'Quads · Hamstrings · Calves',
      exercises: ['leg_press', 'hack_squat', 'leg_extension', 'seated_leg_curl', 'standing_calf'] },
    { id: 'pushB', name: 'Push B', type: 'push', focus: 'Shoulder focus',
      exercises: ['machine_shoulder_press', 'incline_machine', 'cable_lateral', 'cable_fly_low', 'overhead_cable_ext'] },
    { id: 'pullB', name: 'Pull B', type: 'pull', focus: 'Back thickness',
      exercises: ['chest_supported_row', 'close_pulldown', 'straight_arm_pulldown', 'face_pull', 'preacher_machine'] },
  ];

  const muscles = { chest: 'Chest', back: 'Back', shoulders: 'Shoulders', biceps: 'Biceps', triceps: 'Triceps', legs: 'Legs' };
  const equipLabel = { machine: 'Machine', cable: 'Cable', smith: 'Smith', dumbbell: 'Dumbbells', barbell: 'Barbell', bodyweight: 'Bodyweight' };

  return { exercises, days, muscles, equipLabel };
})();
