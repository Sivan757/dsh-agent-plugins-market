<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { SECTIONS } from '../../guide'

// The copied guide files are the single source of their titles: the first
// level-one heading in each file is the title, exactly as GitHub renders it.
const files = import.meta.glob('../../../guide/*.md', { query: '?raw', import: 'default', eager: true })

function titleOf(name: string): string {
  const raw = (files as Record<string, string>)['../../../guide/' + name] ?? ''
  const match = raw.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : name
}

interface Row {
  base: string
  en: string
  zh: string
  route: string
  routeZh: string
}

const sections = computed(() =>
  SECTIONS.map(section => ({
    ...section,
    rows: section.pages.map((base): Row => ({
      base,
      en: titleOf(base + '.md'),
      zh: titleOf(base + '.zh.md'),
      route: withBase('/docs/' + base + '/'),
      routeZh: withBase('/docs/zh/' + base + '/')
    }))
  }))
)
</script>

<template>
  <section v-for="section in sections" :key="section.key">
    <h2>{{ section.en }}</h2>
    <ul>
      <li v-for="row in section.rows" :key="row.base">
        <a :href="row.route">{{ row.en }}</a>
        (<a :href="row.routeZh">简体中文</a>)
      </li>
    </ul>
  </section>
</template>
