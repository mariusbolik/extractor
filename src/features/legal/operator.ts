/**
 * Public operator details shared by every legal page.
 *
 * Keep this object aligned with Eyloo GmbH's published imprint so an address,
 * register number, or contact change cannot drift between separate pages.
 */
export const legalOperator = {
  name: 'Eyloo GmbH',
  street: 'Im Hemchen 29',
  postalCode: '56410',
  city: 'Montabaur',
  country: 'Germany',
  registeredOffice: 'Montabaur, Rhineland-Palatinate, Germany',
  legalForm: 'Gesellschaft mit beschr\u00e4nkter Haftung (GmbH)',
  managingDirector: 'Marius Bolik',
  registerCourt: 'Amtsgericht Montabaur',
  registerNumber: 'HRB 28282',
  vatId: 'DE350377015',
  phoneDisplay: '+49 2602 91962300',
  phoneHref: '+49260291962300',
  email: 'support@extractor.sh',
} as const;

export const LEGAL_LAST_UPDATED = 'August 4, 2026';
