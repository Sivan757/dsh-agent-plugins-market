/**
 * The `/` menu's row identities: which rows this plugin owns, and the panel
 * entry each one translates as.
 *
 * Two halves have to meet, and neither can see the other. The runtime command
 * registries know the call name a command actually got — allocation may have
 * suffixed it — but nothing about translation. The panels own the id and the
 * authored text a translation is cached under, because they are what queued it.
 *
 * The join happens here, on the panel's own output: a registration names the
 * panel id it belongs to, and this looks that entry up and copies the text the
 * panel handed the translator. Deriving the text again would risk a different
 * spelling than the one the cache key was built from, which shows up as the
 * same prose translated — and paid for — twice.
 *
 * The skill half needs no registry: a skill's menu name is the name the panel
 * lists it under, so the panel read is the whole answer.
 * @module runtime/host/menu-row-identities
 */
import type { MenuRowIdentity } from '../../application/ports.js'
import type { PanelResourceStore } from '../../application/panel-resources.js'

/** One live command registration: the menu row's call name and the panel entry behind it. */
export interface MenuRowRegistration {
  /** The call name the `/` menu row carries. */
  readonly name: string
  /** The panel identity the same document is listed and translated under. */
  readonly id: string
}

/** What the join reads. */
export interface MenuRowIdentitySource {
  /** The panels whose entries back the menu rows (the same stores the panel UI reads). */
  readonly panels: { skills: PanelResourceStore; commands: PanelResourceStore }
  /** Every live command registration, from the user and suite registries. */
  readonly commands: readonly MenuRowRegistration[]
}

/**
 * Pair the installed and user-authored entries this plugin owns with the menu
 * rows they appear as.
 *
 * A command whose registration has no panel entry is skipped rather than
 * guessed at: without the panel's own text there is no id to share and no
 * translation to show. A skill the panel lists contributes whatever translation
 * the panel already resolved for it.
 * @param source - the panels to read and the live command registrations to match.
 * @returns one identity per owned menu row.
 */
export async function collectMenuRowIdentities(source: MenuRowIdentitySource): Promise<MenuRowIdentity[]> {
  const [skills, commands] = await Promise.all([source.panels.skills.list(), source.panels.commands.list()])
  const commandsByPanelId = new Map(commands.map(entry => [entry.id ?? entry.name, entry]))
  const identities: MenuRowIdentity[] = []
  for (const registration of source.commands) {
    const entry = commandsByPanelId.get(registration.id)
    if (entry === undefined) continue
    identities.push({
      source: 'commands',
      name: registration.name,
      id: registration.id,
      authoredName: entry.name,
      ...(entry.description === '' ? {} : { authoredDescription: entry.description })
    })
  }
  for (const entry of skills) {
    identities.push({
      source: 'skills',
      name: entry.name,
      id: entry.id ?? entry.name,
      authoredName: entry.name,
      ...(entry.description === '' ? {} : { authoredDescription: entry.description })
    })
  }
  return identities
}
