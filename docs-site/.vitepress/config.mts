import { defineConfig } from 'vitepress'

// Project page: https://sivan757.github.io/dsh-agent-plugins-market/
// GitHub Pages serves the site from a sub path, so every route carries the
// repository name. The rewrites keep the Astro-era URLs: a page the READMEs
// deep-link to must keep its address across the rebuild.
export default defineConfig({
  lang: 'en-US',
  // GitHub Pages serves the site from the repository sub path; every asset and
  // internal link is emitted with this prefix.
  base: '/dsh-agent-plugins-market/',
  title: 'dsh-agent-plugins-market',
  description: 'One-stop skills, subagent, MCP and LSP manager inside DeepSeek Harness (DSH), compatible with Claude Code, Codex, Cursor, Kimi and other agent plugin layouts.',
  srcDir: '.',
  outDir: 'dist',
  srcExclude: ['**/package.json', '**/*.mjs', '**/*.mts', '**/tsconfig.json', '**/.vitepress/**', '**/node_modules/**'],
  ignoreDeadLinks: false,
  // Internal links are emitted extensionless, and scripts/directories.mjs then
  // moves every page to <route>/index.html, the only layout GitHub Pages
  // resolves for the trailing-slash URLs the READMEs deep-link.
  cleanUrls: true,
  sitemap: {
    hostname: 'https://sivan757.github.io'
  },
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/dsh-agent-plugins-market/favicon.svg' }]],
  rewrites: {
    'guide/install.md': 'docs/install.md',
    'guide/install.zh.md': 'docs/zh/install.md',
    'guide/sources.md': 'docs/sources.md',
    'guide/sources.zh.md': 'docs/zh/sources.md',
    'guide/resources.md': 'docs/resources.md',
    'guide/resources.zh.md': 'docs/zh/resources.md',
    'guide/instructions.md': 'docs/instructions.md',
    'guide/instructions.zh.md': 'docs/zh/instructions.md',
    'guide/output-styles.md': 'docs/output-styles.md',
    'guide/output-styles.zh.md': 'docs/zh/output-styles.md',
    'guide/services.md': 'docs/services.md',
    'guide/services.zh.md': 'docs/zh/services.md',
    'guide/translation.md': 'docs/translation.md',
    'guide/translation.zh.md': 'docs/zh/translation.md',
    'guide/settings.md': 'docs/settings.md',
    'guide/settings.zh.md': 'docs/zh/settings.md',
    'guide/workspace.md': 'docs/workspace.md',
    'guide/workspace.zh.md': 'docs/zh/workspace.md',
    'guide/agent-roles.md': 'docs/agent-roles.md',
    'guide/agent-roles.zh.md': 'docs/zh/agent-roles.md',
    'guide/layout-coverage.md': 'docs/layout-coverage.md',
    'guide/layout-coverage.zh.md': 'docs/zh/layout-coverage.md'
  },
  themeConfig: {
    logo: '/favicon.svg',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Install', link: '/install' },
      { text: 'User guide', link: '/docs/install' },
      { text: 'Compatible plugins', link: '/compatible-plugins' },
      { text: 'FAQ', link: '/faq' },
      { text: 'GitHub', link: 'https://github.com/Sivan757/dsh-agent-plugins-market' }
    ],
    sidebar: {
      '/docs/': [
        {
          text: 'Get started',
          items: [{ text: 'Install and requirements', link: '/docs/install' }]
        },
        {
          text: 'Content',
          items: [
            { text: 'Marketplace sources', link: '/docs/sources' },
            { text: 'Your own resources', link: '/docs/resources' },
            { text: 'Workspace instructions', link: '/docs/instructions' },
            { text: 'Output styles', link: '/docs/output-styles' }
          ]
        },
        {
          text: 'Capabilities',
          items: [
            { text: 'MCP, LSP, hooks and commands', link: '/docs/services' },
            { text: 'Translation', link: '/docs/translation' }
          ]
        },
        {
          text: 'Workspace',
          items: [
            { text: 'Settings', link: '/docs/settings' },
            { text: 'Workspace behavior', link: '/docs/workspace' }
          ]
        },
        {
          text: 'Reference',
          items: [
            { text: 'Agent roles', link: '/docs/agent-roles' },
            { text: 'Layout coverage audit', link: '/docs/layout-coverage' }
          ]
        }
      ],
      '/': []
    },
    footer: {
      message: 'dsh-agent-plugins-market — the standard way to run Claude Code, Codex, Cursor and Kimi plugin marketplaces inside DeepSeek Harness.',
      copyright:
        '<a href="https://github.com/Sivan757/dsh-agent-plugins-market">GitHub</a> · <a href="https://www.npmjs.com/package/dsh-agent-plugins-market">npm</a> · MIT License'
    }
  },
  vite: {
    server: {
      fs: {
        // The guide copies are read from the repository root during dev.
        allow: ['..']
      }
    }
  }
})
