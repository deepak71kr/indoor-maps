/**
 * English direction templates.
 *
 * Every entry is a whole sentence (or a named fragment like a turn) with {placeholders}, so
 * other languages can reorder words freely — never glue fragments together in code.
 * Sentences start lowercase: the renderer capitalizes and adds the final period.
 */
export const en = {
  'turn.straight': 'go straight',
  'turn.slight-left': 'bear LEFT',
  'turn.slight-right': 'bear RIGHT',
  'turn.left': 'turn LEFT',
  'turn.right': 'turn RIGHT',
  'turn.u-turn': 'turn around',

  'walk.towards': 'walk to {target}',
  'walk.towards.via': 'walk past {via} to {target}',
  'walk.straight': 'go straight to {target}',
  'walk.straight.via': 'go straight past {via} to {target}',
  'walk.turn': '{turn} and walk to {target}',
  'walk.turn.via': '{turn} and walk past {via} to {target}',
  'target.unnamed': 'the corner about {meters} m ahead',

  'prefix.start': 'with the sign in front of you, {sentence}',
  'prefix.exit.lift': 'exit {connector}, then {sentence}',
  'prefix.exit.stairs': 'on {level}, {sentence}',

  'ride.lift.up': 'take {connector} up to {level}',
  'ride.lift.down': 'take {connector} down to {level}',
  'ride.stairs.up': 'use the {connector} to go up to {level}',
  'ride.stairs.down': 'use the {connector} to go down to {level}',

  'arrive.side': '{place} is {side} 🎉',
  'arrive.here': 'you have arrived at {place} 🎉',
  'arrive.already': 'you are already at {place} 🎉',
  'arrive.locked': 'This is a staff-only area 🔒 Please ask at the door.',
  'side.left': 'on your LEFT',
  'side.right': 'on your RIGHT',
  'side.ahead': 'straight ahead',
  'side.behind': 'behind you',

  'amenity.toilet': 'Toilet',
  'amenity.toilet-accessible': 'Accessible toilet',
  'amenity.water': 'Drinking water',
  'amenity.atm': 'ATM',
  'amenity.wheelchair': 'Wheelchair',
  'amenity.help-desk': 'Help desk',
  'amenity.prayer-room': 'Prayer room',
  'amenity.baby-care': 'Baby care room',
  'amenity.charging': 'Charging point',
  'amenity.fire-extinguisher': 'Fire extinguisher',
  'amenity.aed': 'Defibrillator (AED)',
} as const;

export type MessageKey = keyof typeof en;
/** Every language must provide every key (checked by the compiler). */
export type Messages = Readonly<Record<MessageKey, string>>;
