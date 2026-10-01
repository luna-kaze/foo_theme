import { onActivated, onBeforeUnmount, onDeactivated, onMounted, onUpdated, shallowRef, ref, watch } from 'vue'

export const alphabetLetters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']

const kanaPattern = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const hanPattern = /\p{Script=Han}/u
const hangulPattern = /\p{Script=Hangul}/u
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const preparedGroups = new WeakMap<object, Array<{ letter: string; items: unknown[] }>>()
let pinyinModule: ReturnType<typeof importPinyin> | null = null
let kanaModule: ReturnType<typeof importKana> | null = null
let hangulModule: ReturnType<typeof importHangul> | null = null

function importPinyin() { return import('pinyin-pro') }
function importKana() { return import('wanakana') }
function importHangul() { return import('hangul-romanize') }

function normalizeLatin(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, ' ').trim()
}

export async function phoneticSortKey(label: string, explicitSortName = '') {
  const source = explicitSortName.trim() || label.trim()
  let romanized = source
  if (kanaPattern.test(source)) {
    const { toRomaji } = await (kanaModule ??= importKana())
    romanized = toRomaji(source)
  } else if (hangulPattern.test(source)) {
    const { default: HangulRomanize } = await (hangulModule ??= importHangul())
    romanized = HangulRomanize.Romanize.from(source)
  } else if (hanPattern.test(source)) {
    const { pinyin } = await (pinyinModule ??= importPinyin())
    romanized = pinyin(source, { toneType: 'none' })
  }
  return normalizeLatin(romanized) || source
}

export function alphabetBucket(sortKey: string) {
  const initial = normalizeLatin(sortKey).charAt(0).toLocaleUpperCase()
  return /^[A-Z]$/.test(initial) ? initial : '#'
}

export async function groupAlphabetically<T>(items: T[], label: (item: T) => string, explicitSortName: (item: T) => string = () => '') {
  const prepared = preparedGroups.get(items)
  if (prepared) return prepared as Array<{ letter: string; items: T[] }>
  const groups = new Map<string, Array<{ item: T; sortKey: string }>>()
  const keyedItems = await Promise.all(items.map(async (item) => ({ item, sortKey: await phoneticSortKey(label(item), explicitSortName(item)) })))
  keyedItems.forEach(({ item, sortKey }) => {
    const bucket = alphabetBucket(sortKey)
    const group = groups.get(bucket) ?? []
    group.push({ item, sortKey })
    groups.set(bucket, group)
  })
  const result = alphabetLetters.flatMap((letter) => {
    const group = groups.get(letter)
    if (!group?.length) return []
    group.sort((left, right) => collator.compare(left.sortKey, right.sortKey) || collator.compare(label(left.item), label(right.item)))
    return [{ letter, items: group.map(({ item }) => item) }]
  })
  preparedGroups.set(items, result)
  return result
}

export function useAlphabetGroups<T>(items: () => T[], label: (item: T) => string, explicitSortName: (item: T) => string = () => '') {
  const groups = shallowRef<Array<{ letter: string; items: T[] }>>([])
  let generation = 0
  watch(items, async (nextItems) => {
    const request = ++generation
    const prepared = preparedGroups.get(nextItems)
    if (prepared) {
      groups.value = prepared as Array<{ letter: string; items: T[] }>
      return
    }
    const nextGroups = await groupAlphabetically(nextItems, label, explicitSortName)
    if (request === generation) groups.value = nextGroups
  }, { immediate: true })
  return groups
}

export function useAlphabetNavigation() {
  const activeLetter = ref('')
  const groups = new Map<string, HTMLElement>()
  let scrollRoot: HTMLElement | null = null
  let frame = 0
  let active = true

  function updateActiveLetter() {
    frame = 0
    if (!active || !scrollRoot || !groups.size) return
    const threshold = scrollRoot.getBoundingClientRect().top + 32
    let current = groups.keys().next().value ?? ''
    groups.forEach((element, letter) => {
      if (element.getBoundingClientRect().top <= threshold) current = letter
    })
    activeLetter.value = current
  }

  function scheduleUpdate() {
    if (!active) return
    if (!frame) frame = requestAnimationFrame(updateActiveLetter)
  }

  function registerGroup(letter: string, element: unknown) {
    if (element instanceof HTMLElement) groups.set(letter, element)
    else groups.delete(letter)
    scheduleUpdate()
  }

  function jumpToLetter(letter: string) {
    const target = groups.get(letter)
    if (!target) return
    activeLetter.value = letter
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function attach() {
    active = true
    scrollRoot = document.querySelector<HTMLElement>('.workspace-scroll')
    scrollRoot?.addEventListener('scroll', scheduleUpdate, { passive: true })
    scheduleUpdate()
  }
  function detach() {
    active = false
    scrollRoot?.removeEventListener('scroll', scheduleUpdate)
    if (frame) cancelAnimationFrame(frame)
    frame = 0
  }
  onMounted(attach)
  onActivated(attach)
  onDeactivated(detach)
  onUpdated(scheduleUpdate)
  onBeforeUnmount(detach)

  return { activeLetter, registerGroup, jumpToLetter }
}
