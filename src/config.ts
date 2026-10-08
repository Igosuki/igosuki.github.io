// Site-wide settings. Edit these first.
export const SITE = {
  name: 'Guillaume Balaine',
  title: 'Guillaume Balaine',
  description:
    'Startup ideas with working prototypes, from a five-time CTO. If you want to build one, get in touch.',
  // TODO: set the address you want people to write to.
  email: 'hello@gepsens.com',
  // TODO: your Buttondown username (https://buttondown.com). Leave empty to hide the signup form.
  buttondown: '',
  links: [
    { label: 'GitHub', href: 'https://github.com/Igosuki' },
    // TODO: add LinkedIn / X / etc.
  ],
};

export const STATUS_LABEL: Record<string, string> = {
  exploring: 'Exploring',
  prototype: 'Prototype works',
  'looking-for-partners': 'Looking for partners',
  building: 'Building',
  shelved: 'Shelved',
};
