import React from 'react'

const lazyLoad = (importFn) => React.lazy(importFn)

export const appNavRoutes = [
  { path: '/flow', label: 'Content Orchestration Studio' },
  { path: '/audience', label: 'Audience State Orchestration Studio' },
  { path: '/prb', label: 'PRB Explorer' }
]

export const appRouteConfig = [
  {
    path: '/flow',
    component: lazyLoad(() => import('./apps/content-orchestration').then((m) => ({ default: m.default })))
  },
  {
    path: '/audience',
    component: lazyLoad(() => import('./screens/audience/AudienceStateStudio').then((m) => ({ default: m.default })))
  },
  {
    path: '/prb',
    component: lazyLoad(() => import('./apps/prb').then((m) => ({ default: m.default })))
  },
  {
    path: '/prb/:prbId/templates',
    component: lazyLoad(() => import('./screens/TemplateSelect').then((m) => ({ default: m.TemplateSelect })))
  },
  {
    path: '/prb/:prbId/templates/:templateId/studio',
    component: lazyLoad(() => import('./screens/TemplateStudio').then((m) => ({ default: m.TemplateStudio })))
  }
]
