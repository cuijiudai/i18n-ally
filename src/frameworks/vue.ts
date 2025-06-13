import { TextDocument } from 'vscode'
import { Framework } from './base'
import { LanguageId } from '~/utils'
import { DefaultDynamicExtractionsRules, DefaultExtractionRules, extractionsParsers } from '~/extraction'
import { Config, DetectionResult } from '~/core'

class VueFramework extends Framework {
  id = 'vue'
  display = 'Vue'

  detection = {
    packageJSON: [
      'vue-i18n',
      'vuex-i18n',
      '@panter/vue-i18next',
      '@nuxtjs/i18n',
      'nuxt-i18n',
      '@intlify/nuxt3',
    ],
  }

  languageIds: LanguageId[] = [
    'vue',
    'vue-html',
    'javascript',
    'typescript',
    'javascriptreact',
    'typescriptreact',
    'ejs',
  ]

  // for visualize the regex, you can use https://regexper.com/
  usageMatchRegex = [
    '(?:i18n(?:-\\w+)?[ \\n]\\s*(?:\\w+=[\'"][^\'"]*[\'"][ \\n]\\s*)?(?:key)?path=|v-t=[\'"`{]|(?:this\\.|\\$|i18n\\.|[^\\w\\d])(?:t|tc|te)\\()\\s*[\'"`]({key})[\'"`]',
  ]

  // 根据给定的keypath和args，以及可选的doc和detection，重构模板
  refactorTemplates(keypath: string, args: string[] = [], doc?: TextDocument, detection?: DetectionResult) {
    // 将keypath转换为字符串
    let params = `'${keypath}'`
    // 如果args不为空，则将args转换为字符串并添加到params中
    if (args.length)
      params += `, [${args.join(', ')}]`

    // 根据detection的source属性，返回不同的模板
    switch (detection?.source) {
      case 'html-inline':
        return [`{{ $t(${params}) }}`]
      case 'html-attribute':
        return [`$t(${params})`]
      case 'js-string':
        // 如果detection的source属性为js-string，则根据Config.vueApiStyle的值返回不同的模板,兼容 vue3
        if (Config.vueApiStyle) {
          if (Config.vueApiStyle === 'Composition')
            return [`t(${params})`]
          else
            return [`this.$t(${params})`]
        }
        return [`this.$t(${params})`, `i18n.t(${params})`, `t(${params})`]
    }

    // 如果detection的source属性不匹配，则返回默认的模板
    return [
      `{{ $t(${params}) }}`,
      `this.$t(${params})`,
      `$t(${params})`,
      `i18n.t(${params})`,
      // vue-i18n-next
      `{{ t(${params}) }}`,
      `t(${params})`,
      keypath,
    ]
  }

  enableFeatures = {
    LinkedMessages: true,
  }

  supportAutoExtraction = ['vue']

  detectHardStrings(doc: TextDocument) {
    const text = doc.getText()

    const result = extractionsParsers.html.detect(
      text,
      DefaultExtractionRules,
      DefaultDynamicExtractionsRules,
      Config.extractParserHTMLOptions,
      // <script>
      script => extractionsParsers.babel.detect(
        script,
        DefaultExtractionRules,
        DefaultDynamicExtractionsRules,
        Config.extractParserBabelOptions,
      ),
      // 过滤掉 : 开头的，兼容 :label="`cess`" 被 二次替换问题
      // 在监测的时候还是会出现，但是不进行 替换
    ).filter(item => item.attrName?.charAt(0) !== ':' && item.attrName?.slice(0, 7) !== 'v-bind:')
    return result
  }
}

export default VueFramework
