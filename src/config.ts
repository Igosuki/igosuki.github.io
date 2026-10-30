// Site-wide settings. Edit these first.
export const SITE = {
  name: 'Guillaume Balaine',
  title: "Guillaume Balaine's blog: software, agents, and startup ideas",
  description:
    'Software, AI agents, and startup ideas from a former CTO, built in the open with working prototypes. If you want to build one, get in touch.',
  role: 'Former CTO, AI agents and distributed systems',
  photo: '/images/guillaume-balaine.jpg',
  ogImage: '/images/og-default.jpg',
  email: 'igosuki.github@gmail.com',
  // TODO: your Buttondown username (https://buttondown.com). Leave empty to hide the signup form.
  buttondown: '',
  goatcounter: 'igosuki',
  links: [
    { label: 'GitHub', href: 'https://github.com/Igosuki' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/guillaumebalaine' },
    { label: 'X', href: 'https://x.com/Igosuki' },
  ],
};

export const STATUS_LABEL: Record<string, string> = {
  exploring: 'Exploring',
  prototype: 'Prototype works',
  building: 'Building',
  shelved: 'Shelved',
};
