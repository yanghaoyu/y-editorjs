import * as Y from 'yjs';
import uuid from 'uuid/dist/v4';
import EditorJS from '@editorjs/editorjs';
import { isPlainObject, isString, xor } from 'lodash/fp';
import { createMutex } from './utils/mutex'

// from editor.js
const Block = {
  CSS: {
    wrapper: 'ce-block',
    wrapperStretched: 'ce-block--stretched',
    content: 'ce-block__content',
    focused: 'ce-block--focused',
    selected: 'ce-block--selected',
    dropTarget: 'ce-block--drop-target',
  }
}

export class EditorBinding {
  yArray: Y.Array<any>

  observer: MutationObserver

  holder: HTMLElement

  editor: EditorJS

  isReady: Promise<any>

  mux

  mapping = new Map()

  constructor(editor, holder, yArray) {
    this.holder = holder
    this.editor = editor
    this.yArray = yArray
    this.mux = createMutex()
    this.isReady = this.initYDoc()
    this.setObserver()
  }

  get editorBlocks() {
    const blockCount = this.editor.blocks.getBlocksCount()
    const blocks = []
    for (let i = 0; i < blockCount; i += 1) {
      blocks.push(this.editor.blocks.getBlockByIndex(i))
    }
    return blocks
  }

  private async initYDoc() {
    await this.editor.isReady
    if (this.yArray.length) {
      await this.editor.blocks.render({
        blocks: this.yArray.toArray()
      })
    }
    this.yArray.observeDeep((evt, tr) => {
      this.mux(() => {
        const docArr = this.yArray.toArray()
        // add or delete
        const changed = xor(docArr, [...this.mapping.keys()])
        changed.forEach(it => {
          if (this.mapping.has(it)) {
            // del an item
            const block = this.mapping.get(it)
            this.mapping.delete(it)
            this.editor.blocks.delete(this.editorBlocks.indexOf(block))
          } else {
            // add an item
            const index = docArr.indexOf(it)
            this.editor.blocks.insert(it.type, it.data, null, index)
            this.mapping.set(it, this.editor.blocks.getBlockByIndex(index))
          }
        });
      })
    })
  }

  private async setObserver() {
    const observerOptions = {
      childList: true,
      attributes: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    };

    this.observer = new MutationObserver((mutationList, observer) => {
      this.mutationHandler(mutationList, observer);
    });
    await this.editor.isReady
    this.observer.observe(this.holder.querySelector('.codex-editor__redactor'), observerOptions)
  }

  private mutationHandler(mutationList: MutationRecord[], observer): void {
    /**
     * We divide two Mutation types:
     * 1) mutations that concerns client changes: settings changes, symbol added, deletion, insertions and so on
     * 2) functional changes. On each client actions we set functional identifiers to interact with user
     */
    const changed = []

    mutationList.forEach((mutation) => {
      const target = mutation.target as Element
      const blockSelector = '.' + Block.CSS.wrapper

      function findChangedBlockElement(el) {
        // text element not contains closest
        return el.closest
          ? el.closest(blockSelector)
          // parentElement is null when text element removed
          : el.parentElement?.closest(blockSelector)
      }

      const { addedNodes, removedNodes } = mutation
      const blockElements = Array.from(this.holder.querySelectorAll(blockSelector))
      const changeType = addedNodes.length
        ? 'add'
        : removedNodes.length
          ? 'remove'
          : 'update'

      switch (mutation.type) {
        case 'childList':
        case 'characterData':
          const blockElement = findChangedBlockElement(target)
          if (blockElement) {
            changed.push({
              changeType,
              blockElement,
              index: blockElements.indexOf(blockElement),
            });
          }
          break;
        case 'attributes':
          /**
           * Changes on Element.ce-block usually is functional
           */
          if (!target.classList.contains(Block.CSS.wrapper)) {
            const blockElement = findChangedBlockElement(target)
            if (blockElement) {
              changed.push({
                changeType,
                blockElement,
                index: blockElements.indexOf(blockElement),
              });
            }
            break;
          }
      }
    });

    if (changed.length > 0) {
      this.onBlockChange(changed)
    }
  }

  private async onBlockChange(changed) {
    // todo: maybe optimize, merge call save()
    for await (const { changeType, blockElement, index } of changed) {
      const savedData = await this.editorBlocks[index]?.save()
      const blockData = { type: savedData.tool, data: savedData.data }
      // avoid calling observerDeep handler
      this.mux(() => {
        switch (changeType) {
          case 'add':
            const blockId = uuid()
            blockElement.setAttribute('data-block-id', blockId)
            this.yArray.insert(index, [blockData])
            this.mapping.set(blockData, this.editorBlocks[index])
            break;
          case 'remove':
            this.yArray.delete(index)
            this.mapping.delete(this.yArray.toArray()[index])
            break;
          case 'update':
            // todo: diff block data and doc data
            this.mapping.delete(this.yArray.toArray()[index])
            this.yArray.delete(index)
            this.yArray.insert(index, [blockData])
            this.mapping.set(blockData, this.editorBlocks[index])
            break;
        }
      })
    }

    console.log('------ binding onchange:', changed, this.yArray.toJSON());
  }
}


export function jsonMap2Y(json) {
  if (Array.isArray(json)) {
    const arr = new Y.Array()
    const rs = json.map((it) => jsonMap2Y(it))
    arr.push(rs)
    return arr
  } else if (isPlainObject(json)) {
    const map = new Y.Map()
    for (const key in json) {
      map.set(key, jsonMap2Y(json[key]))
    }
    return map
  } else if (isString(json)) {
    return new Y.Text(json)
  }
  return json
}

export function changes2ops() {

}