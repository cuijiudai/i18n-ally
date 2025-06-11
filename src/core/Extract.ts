import { basename, extname } from 'path'
import { TextDocument, window } from 'vscode'
import { nanoid } from 'nanoid'
import limax from 'limax'
import { Config, Global } from '../extension'
import { ExtractInfo } from './types'
import { CurrentFile } from './CurrentFile'
import { Translator } from './Translator'
import { changeCase } from '~/utils/changeCase'

export async function generateKeyFromText(text: string, filepath?: string, reuseExisting = false, usedKeys: string[] = []) {
  let key: string | undefined

  // already existed, reuse the key
  // mostly for auto extraction
  if (reuseExisting) {
    key = Global.loader.searchKeyForTranslations(text)
    if (key)
      return key
  }

  // keygent
  const keygenStrategy = Config.keygenStrategy
  if (keygenStrategy === 'random') {
    key = nanoid()
  }
  else if (keygenStrategy === 'empty') {
    key = ''
  }
  else if (keygenStrategy === 'source') {
    key = text
  }
  else if (keygenStrategy === 'english') {
    try {
      // 直接调用翻译文本，最多重试10次
      let retries = 10
      let result
      while (retries > 0) {
        try {
          // eslint-disable-next-line no-console
          console.log('Retrying translation...')
          result = await Translator.translateText(text, Config.sourceLanguage, 'en')
          if (result)
            break
          retries--
        }
        catch (err) {
          if (retries === 1) throw err // 最后一次尝试时才抛出错误
          retries--
          await new Promise(resolve => setTimeout(resolve, 1000)) // 等待1秒后重试
        }
      }
      if (result) {
        key = limax(result, {
          separator: '-',
          maintainCase: false,
          tone: false,
        })
      }
      else {
        key = ''
      }
    }
    catch (e) {
      console.error('Translation failed after retries:', e)
      key = ''
    }
  }
  else {
    text = text.replace(/\$/g, '')
    // 转换 中文 为拼音的位置
    key = limax(text, { separator: Config.preferredDelimiter, tone: false })
      .slice(0, Config.extractKeyMaxLength ?? Infinity)
  }

  const keyPrefix = Config.keyPrefix
  if (keyPrefix && keygenStrategy !== 'empty' && keygenStrategy !== 'source')
    key = keyPrefix + key

  if (filepath && key.includes('fileName')) {
    key = key
      .replace('{fileName}', basename(filepath))
      .replace('{fileNameWithoutExt}', basename(filepath, extname(filepath)))
  }

  key = changeCase(key, Config.keygenStyle).trim()

  // some symbol can't convert to alphabet correctly, apply a default key to it
  if (!key)
    key = 'key'

  // suffix with a auto increment number if same key
  if (usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key)) {
    const originalKey = key
    let num = 0

    do {
      key = `${originalKey}${Config.preferredDelimiter}${num}`
      num += 1
    } while (
      usedKeys.includes(key) || CurrentFile.loader.getNodeByKey(key, false)
    )
  }

  return key
}

export async function extractHardStrings(document: TextDocument, extracts: ExtractInfo[], saveFile = false) {
  if (!extracts.length)
    return

  const editor = await window.showTextDocument(document)
  const filepath = document.uri.fsPath
  const sourceLanguage = Config.sourceLanguage

  extracts.sort((a, b) => b.range.start.compareTo(a.range.start))

  // replace
  await editor.edit((editBuilder) => {
    for (const extract of extracts) {
      editBuilder.replace(
        extract.range,
        extract.replaceTo,
      )
    }
  })

  // save keys
  await CurrentFile.loader.write(
    extracts
      .filter(i => i.keypath != null && i.message != null)
      .map(e => ({
        textFromPath: filepath,
        filepath: undefined,
        keypath: e.keypath!,
        value: e.message!,
        locale: e.locale || sourceLanguage,
      })),
  )

  if (saveFile)
    await document.save()

  CurrentFile.invalidate()
}
