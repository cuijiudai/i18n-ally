import path from 'path'
import pLimit from 'p-limit'
import { commands, ProgressLocation, Range, TextDocument, Uri, window, workspace } from 'vscode'
import { notNullish } from '@antfu/utils'
import fs from 'fs-extra'
import { DetectHardStrings } from './detectHardStrings'
import { ExtensionModule } from '~/modules'
import { Commands } from '~/commands'
import { extractHardStrings, generateKeyFromText } from '~/core/Extract'
import { Config, Global } from '~/core'
import { parseHardString } from '~/extraction/parseHardString'
import { DetectionResultToExtraction } from '~/editor/extract'
import { Log } from '~/utils'
import { gitignoredGlob } from '~/utils/glob'
import { ActionSource, Telemetry, TelemetryKey } from '~/core/Telemetry'
import i18n from '~/i18n'

export async function BatchHardStringExtraction(...args: any[]) {
  const documents: (TextDocument | undefined)[] = []
  let actionSource: ActionSource

  // call from file explorer context
  if (args.length >= 2 && Array.isArray(args[1])) {
    actionSource = ActionSource.ContextMenu
    const map = new Map<string, Uri>()

    for (const uri of args[1]) {
      // folder, scan glob
      if (fs.lstatSync(uri.fsPath).isDirectory()) {
        const files = await gitignoredGlob('**/*.*', uri.fsPath)

        files.forEach((f) => {
          if (!map.has(f))
            map.set(f, Uri.file(f))
        })
      }
      // file, append to the map
      else {
        map.set(uri.fsPath, uri)
      }
    }

    const files = [...map.values()]

    documents.push(
      ...await Promise.all(files.map(i => workspace.openTextDocument(i))),
    )
  }
  // call from command pattale
  else {
    actionSource = ActionSource.CommandPattele
    documents.push(window.activeTextEditor?.document)
  }

  Telemetry.track(TelemetryKey.ExtractStringBulk, { source: actionSource, files: documents.length })

  Log.info('📤 Bulk extracting')
  Log.info(documents.map(i => `  ${i?.uri.fsPath}`).join('\n'))

  for (const document of documents) {
    if (!document)
      continue

    try {
      const result = await DetectHardStrings(document, false)
      Log.info(`📤 Extracting [${result?.length || 0}] ${document.uri.fsPath}`)
      if (!result)
        continue

      const usedKeys: string[] = []
      // 获取第一个 keypath 用于请求文件路径
      const firstItem = result[0]
      const firstOptions = DetectionResultToExtraction(firstItem, document)
      const firstText = firstOptions.rawText || firstOptions.text
      const firstKeypath = await generateKeyFromText(firstText, document.uri.fsPath)
      // 只请求一次文件路径
      const file_path = await Global.loader.requestMissingFilepath({
        keypath: firstKeypath,
        locale: Config.sourceLanguage,
      })
      // 获取文件名（不带扩展名）
      const fileName = file_path && typeof file_path === 'string' ? path.basename(file_path, path.extname(file_path)) : ''
      if (!fileName) {
        window.showWarningMessage(i18n.t('prompt.extraction_canceled'))
        return
      }
      const limit = pLimit(3)

      await window.withProgress({
        location: ProgressLocation.Notification,
        title: i18n.t('prompt.extraction_in_progress'),
        cancellable: true,
      // eslint-disable-next-line space-before-function-paren
      }, async (progress, token) => {
        try {
          const totalItems = result.length // 获取总任务数
          const increment = 1 / totalItems * 100
          let finished = 0 // 完成的任务数
          progress.report({
            increment: 0, // 初始进度
          })

          // eslint-disable-next-line space-before-function-paren
          const tasks = result.map((i, index) => limit(async () => {
            // const tasks = result.map((i) => {
            if (token.isCancellationRequested)
              return null
            progress.report({ message: `(${index + 1}/${result.length})` })

            const options = DetectionResultToExtraction(i, document)

            if (options.rawText && !options.text) {
              const result = parseHardString(options.rawText, options.document.languageId, options.isDynamic)
              options.text = result?.text || ''
              options.args = result?.args
            }

            const { rawText, text, range, args } = options
            const filepath = document.uri.fsPath
            const keypath = await generateKeyFromText(rawText || text, filepath, true, usedKeys)
            if (!keypath)
              return null
            // 下面添加 zh-CN 前缀了
            // keypath = fileName && keypath ? `${fileName}.${keypath}` : keypath;
            const templates = Global.interpretRefactorTemplates(keypath, args, document, i).filter(Boolean)

            if (!templates.length) {
              Log.warn(`No refactor template found for "${keypath}" in "${filepath}"`)
              return undefined
            }
            usedKeys.push(keypath)
            finished += 1
            progress.report({
              increment,
              message: `${finished}/${totalItems}`,
            })

            const returnVal = {
              range,
              replaceTo: templates[0],
              keypath,
              message: text,
              locale: Config.displayLanguage,
            }
            // 处理 vue html-attribute 不带 ：问题
            if (['vue'].includes(options.document.languageId || '')) {
              const isAttr = i.source === 'html-attribute'
              if (isAttr) {
                // 替换 range
                returnVal.range = new Range(
                  document.positionAt(i.fullStart as number),
                  document.positionAt(i.fullEnd as number),
                )
                // eslint-disable-next-line prefer-template
                returnVal.replaceTo = ':' + i.attrName + '="' + templates[0] + '"'
              }
            }
            return returnVal
          }))
          const resultMap = (await Promise.all(tasks)).filter(notNullish)
          if (token.isCancellationRequested) {
            window.showWarningMessage(i18n.t('prompt.extraction_canceled_by_user'))
            return
          }
          // eslint-disable-next-line no-console
          console.log('resultMap', resultMap)
          // 过滤掉 undefined 的项并调用 extractHardStrings
          await extractHardStrings(document, resultMap, true)
          window.showInformationMessage(i18n.t('prompt.extraction_done'))
        }
        catch (error) {
          Log.error(error)
          window.showErrorMessage(i18n.t('prompt.extraction_failed'))
        }
      })
    }
    catch (e) {
      Log.error(`Failed to extract ${document.fileName}`)
      Log.error(e, false)
    }
  }
}

const m: ExtensionModule = () => {
  return [
    commands.registerCommand(Commands.extract_hard_strings_batch, BatchHardStringExtraction),
  ]
}

export default m
