/**
 * An icon for a room, from what it is called: "Computer Lab" → 💻, "Badminton court" → 🏸.
 * A room's own `icon` (set in the editor) always wins; unknown names get the caller's
 * fallback (the category icon). Order matters: specific words come before general ones.
 */
import type { Room } from '@innermap/schema';

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/toilet|washroom|\bwc\b|restroom/i, '🚻'],
  [/\bai\b|machine learning|\bml\b|robot/i, '🤖'],
  [/computer|software|database|server|it lab|digital/i, '💻'],
  [/network|communication|telecom/i, '📡'],
  [/electronic|vlsi|embedded|signal|circuit/i, '🔌'],
  [/physics/i, '⚛️'],
  [/chemistry|chemical/i, '⚗️'],
  [/workshop|thermal|fluid|\bcad\b|mechanical/i, '🛠️'],
  [/survey|concrete|soil|hydraulic|transport|civil/i, '🏗️'],
  [/patholog|blood|sample/i, '🩸'],
  [/x-ray|radiolog|\bmri\b|ct scan|scan/i, '🩻'],
  [/dental|dentist/i, '🦷'],
  [/\beye\b|optic/i, '👁️'],
  [/physio/i, '💆'],
  [/pharmacy|chemist/i, '💊'],
  [/emergency|ambulance|casualty/i, '🚑'],
  [/ward|observation|\bicu\b/i, '🛏️'],
  [/counsel/i, '💬'],
  [/\bopd\b|doctor|clinic|chamber|medical|dressing|injection|orthop|paediatric|\bent\b/i, '🩺'],
  [/library|book|reading|stack|periodical|journal|thesis|reference|newspaper/i, '📚'],
  [/swim|pool|lifeguard|aquatic/i, '🏊'],
  [/changing|shower/i, '🚿'],
  [/\bgym\b|fitness/i, '🏋️'],
  [/badminton|squash|tennis court/i, '🏸'],
  [/table tennis/i, '🏓'],
  [/yoga/i, '🧘'],
  [/chess|carrom|indoor games/i, '♟️'],
  [/trophy/i, '🏆'],
  [/lecture|classroom|seminar|senate|tutorial|case study|mba/i, '🎓'],
  [/\blab\b|laborator/i, '🧪'],
  [
    /admission|exam|scholarship|welfare|placement|alumni|iqac|research cell|legal|committee|international/i,
    '📋',
  ],
  [/\batm\b/i, '🏧'],
  [/account|fee|billing|cash|bank|passbook/i, '🧾'],
  [/post office|dispatch|courier/i, '📮'],
  [/coffee|\btea\b/i, '☕'],
  [/juice|ice-cream|ice cream/i, '🍹'],
  [/bakery|cake/i, '🥐'],
  [
    /mess|dining|canteen|cafeteria|food|kitchen|snack|maggi|pantry|counter.*(indian|chinese)|chinese|south indian/i,
    '🍽️',
  ],
  [/hostel|rooms \d|guest room|quarter|dorm/i, '🛏️'],
  [/common room|lounge|waiting|visitors/i, '🛋️'],
  [/reception|help desk|pass desk|enquiry/i, '🛎️'],
  [/security|cctv|guard/i, '🛡️'],
  [/electric|substation|control room|pump|generator/i, '⚡'],
  [/temple|prayer|mosque|church|chapel/i, '🛕'],
  [/salon|barber/i, '💇'],
  [/laundry/i, '🧺'],
  [/tailor/i, '🧵'],
  [/stationery|photocopy|print|binding/i, '🖨️'],
  [/mobile/i, '📱'],
  [/auditorium|main hall|green room|rehearsal|stage|costume/i, '🎭'],
  [/conference|board room|meeting|interview/i, '🤝'],
  [/store|archive|record|locker|equipment/i, '📦'],
  [/shop|general store|market/i, '🛍️'],
  [/hod|director|dean|registrar|warden|manager|officer|\bpa\b|faculty|office|department/i, '🗂️'],
];

/** The room's own icon, else one matched from its name, else `fallback`. */
export function roomIcon(room: Pick<Room, 'name' | 'icon'>, fallback: string): string {
  if (room.icon) return room.icon;
  for (const [pattern, icon] of RULES) if (pattern.test(room.name)) return icon;
  return fallback;
}
