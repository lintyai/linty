import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'VoiceInk',
  tagline: 'Your voice, instantly inked.',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://voiceink.app',
  baseUrl: '/',

  organizationName: 'voiceink',
  projectName: 'voiceink',

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: 'anonymous',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
      },
    },
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/voiceink-social-card.jpg',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: '',
      logo: {
        alt: 'VoiceInk',
        src: 'img/logo.svg',
        srcDark: 'img/logo.svg',
      },
      style: 'dark',
      items: [
        {href: '/#features', label: 'Features', position: 'left'},
        {href: '/#pricing', label: 'Pricing', position: 'left'},
        {to: '/docs/intro', label: 'Docs', position: 'left'},
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          to: '/login',
          label: 'Log in',
          position: 'right',
          className: 'navbar__link--login',
        },
        {
          to: '/signup',
          label: 'Get Started Free',
          position: 'right',
          className: 'navbar__link--cta',
        },
      ],
    },
    footer: undefined,
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
