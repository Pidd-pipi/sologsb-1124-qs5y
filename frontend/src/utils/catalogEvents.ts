/**
 * 编目数据变更的跨标签页通知。
 *
 * 收藏者常在两个标签页里同时整理邮品：一个标签页改了邮路节点或邮戳年代后，
 * 另一个标签页必须立刻感知并重算关联实寄封。主通道用 BroadcastChannel，
 * 个别浏览器不支持时回退到 localStorage 的 storage 事件。
 *
 * 约定：由发起写库的标签页调用 emitChange；其他标签页的 onCatalogChange
 * 回调会收到通知，发起方自身不会收到自己发出的变更。
 */

export type CatalogEntity = 'postmark' | 'cover' | 'route' | 'stampEntry'

export interface CatalogChangeMessage {
  /** 变更的实体类型 */
  entity: CatalogEntity
  /** 被改动记录的主键；批量迁移等无具体主键场景可省略 */
  id?: number
  /** 发起标签页标识，用于忽略自己发出的消息 */
  origin: string
  at: string
}

const CHANNEL_NAME = 'gbpostmark:catalog-changes'
const STORAGE_KEY = 'gbpostmark:catalog-change'

let originId = ''
let channel: BroadcastChannel | null = null

/** 当前标签页的唯一标识（进程内复用）。 */
function currentOrigin(): string {
  if (!originId) {
    originId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
  return originId
}

function getChannel(): BroadcastChannel | null {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

type ChangeHandler = (message: CatalogChangeMessage) => void

/**
 * 订阅其他标签页的编目变更。返回取消订阅函数。
 * BroadcastChannel 不可用时改用 storage 事件兜底。
 */
export function onCatalogChange(handler: ChangeHandler): () => void {
  const bc = getChannel()
  const onMessage = (event: MessageEvent<CatalogChangeMessage>) => {
    const message = event.data
    if (!message || message.origin === currentOrigin()) return
    handler(message)
  }
  if (bc) {
    bc.addEventListener('message', onMessage)
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const message = JSON.parse(event.newValue) as CatalogChangeMessage
      if (!message || message.origin === currentOrigin()) return
      handler(message)
    } catch {
      /* 忽略无法解析的兜底消息 */
    }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    if (bc) bc.removeEventListener('message', onMessage)
    window.removeEventListener('storage', onStorage)
  }
}

/** 通知其他标签页：某类编目数据已被本标签页改动。 */
export function emitChange(entity: CatalogEntity, id?: number): void {
  const message: CatalogChangeMessage = { entity, id, origin: currentOrigin(), at: new Date().toISOString() }
  const bc = getChannel()
  if (bc) {
    bc.postMessage(message)
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message))
  } catch {
    /* localStorage 不可用时跨标签页通知降级为无 */
  }
}
