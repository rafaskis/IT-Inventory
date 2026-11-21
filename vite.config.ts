import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages project sites are hosted under /<repository>/.
// Keep the root path for local development and user/organization Pages sites.
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true'
const isUserOrOrganizationSite = repositoryName?.endsWith('.github.io') ?? false
const base =
  isGitHubActions && repositoryName && !isUserOrOrganizationSite
    ? `/${repositoryName}/`
    : '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
  ],
})
