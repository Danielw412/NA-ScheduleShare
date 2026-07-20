function normalizeSelector(selector: string) {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([>,+~])\s*/g, '$1')
    .trim()
}

export function getCssDeclarations(css: string, selector: string): Record<string, string> {
  const targetSelector = normalizeSelector(selector)
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g

  for (const match of cssWithoutComments.matchAll(rulePattern)) {
    if (normalizeSelector(match[1]) !== targetSelector) continue

    return Object.fromEntries(
      match[2]
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
          const separatorIndex = declaration.indexOf(':')
          return [
            declaration.slice(0, separatorIndex).trim(),
            declaration.slice(separatorIndex + 1).trim(),
          ]
        }),
    )
  }

  throw new Error(`CSS rule not found: ${selector}`)
}
