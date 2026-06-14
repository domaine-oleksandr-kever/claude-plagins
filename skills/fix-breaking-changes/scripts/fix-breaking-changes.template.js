#!/usr/bin/env node
/**
 * Breaking-changes fixer (template).
 *
 * Copy this file to the repo root as `scripts/fix-breaking-changes.js`, then customize ONLY the
 * `applyFixes` function below based on the patterns documented in `breaking-changes.md`.
 * Run with `node scripts/fix-breaking-changes.js`, verify with theme check, then delete the copy.
 *
 * It walks every JSON file in `templates/` plus `config/settings_data.json`, applies `applyFixes`
 * recursively, and writes the result back — preserving template comment headers and 2-space JSON.
 */
const fs = require('fs')
const path = require('path')

const templatesDir = './templates'
const configFile = './config/settings_data.json'

// ========================================
// CUSTOMIZE THIS SECTION BASED ON breaking-changes.md
// ========================================
const applyFixes = (obj) => {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(applyFixes)

  const result = { ...obj }

  // ADD YOUR BREAKING-CHANGE FIXES HERE. Common patterns:
  //
  // 1. Remove specific settings:
  //    if (result.settings?.product === '{{ closest.product }}') delete result.settings.product
  //    delete result.settings?.deprecated_setting
  //
  // 2. Update block types:
  //    if (result.type === 'old-block-type') result.type = 'new-block-type'
  //
  // 3. Update setting values:
  //    if (result.settings?.some_property === 'old-value') result.settings.some_property = 'new-value'
  //
  // 4. Rename properties:
  //    if (result.old_property_name) {
  //      result.new_property_name = result.old_property_name
  //      delete result.old_property_name
  //    }

  // Recurse into nested objects.
  for (const key in result) {
    if (typeof result[key] === 'object' && result[key] !== null) {
      result[key] = applyFixes(result[key])
    }
  }
  return result
}
// ========================================
// END CUSTOMIZATION SECTION
// ========================================

const processTemplateFile = (filePath) => {
  try {
    console.log(`Processing ${filePath}...`)
    const content = fs.readFileSync(filePath, 'utf8')

    // Preserve a leading /* ... */ comment header if present.
    const commentMatch = content.match(/^(\/\*[\s\S]*?\*\/)\s*/)
    const comment = commentMatch ? commentMatch[1] : ''
    const jsonContent = commentMatch ? content.slice(commentMatch[0].length) : content

    const processed = applyFixes(JSON.parse(jsonContent))
    const json = JSON.stringify(processed, null, 2)
    fs.writeFileSync(filePath, comment ? `${comment}\n${json}` : json)
    console.log(`✓ Updated ${filePath}`)
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message)
  }
}

const processConfigFile = (filePath) => {
  try {
    console.log(`Processing ${filePath}...`)
    const processed = applyFixes(JSON.parse(fs.readFileSync(filePath, 'utf8')))
    fs.writeFileSync(filePath, JSON.stringify(processed, null, 2))
    console.log(`✓ Updated ${filePath}`)
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message)
  }
}

const main = () => {
  console.log('🔧 Fixing breaking changes in template files and config...\n')

  const jsonFiles = fs.readdirSync(templatesDir).filter((f) => f.endsWith('.json'))
  if (jsonFiles.length > 0) {
    console.log(`Found ${jsonFiles.length} template files to process:\n`)
    jsonFiles.forEach((f) => processTemplateFile(path.join(templatesDir, f)))
  } else {
    console.log('No JSON template files found.')
  }

  if (fs.existsSync(configFile)) {
    console.log(`\nProcessing config file: ${configFile}`)
    processConfigFile(configFile)
  } else {
    console.log(`\nConfig file not found: ${configFile}`)
  }

  console.log('\n✅ All template files and config have been processed!')
  console.log('Next: run theme check to verify fixes')
}

if (require.main === module) main()
