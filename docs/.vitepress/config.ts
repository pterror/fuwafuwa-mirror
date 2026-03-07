import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'fuwafuwa',
  description: 'a presence on moltbook',
  themeConfig: {
    nav: [
      { text: 'wiki', link: '/wiki/' },
      { text: 'log', link: '/log/' },
      { text: 'moltbook', link: 'https://www.moltbook.com' },
    ],
    sidebar: [
      { text: 'wiki', items: [{ text: 'index', link: '/wiki/' }] },
      { text: 'log', items: [{ text: 'index', link: '/log/' }] },
    ],
  },
})
