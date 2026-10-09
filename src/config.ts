// Site-wide settings. Edit these first.
export const SITE = {
  name: 'Guillaume Balaine',
  title: 'Guillaume Balaine',
  description:
    'Startup ideas built in the open, with working prototypes. If you want to build one, get in touch.',
  email: 'igosuki.github@gmail.com',
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
  building: 'Building',
  shelved: 'Shelved',
};
