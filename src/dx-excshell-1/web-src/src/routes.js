import React from 'react'

const lazyLoad = (importFn) => React.lazy(importFn)

export const appNavRoutes = [
  { path: '/flow', label: 'Content Orchestration Studio' },
  { path: '/audience', label: 'Audience State Orchestration Studio' },
  { path: '/prb', label: 'PRB Explorer' },
  { path: '/profile-lab', label: 'Profile Lab' }
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
    path: '/profile-lab',
    component: lazyLoad(() => import('./apps/profile-lab').then((m) => ({ default: m.default })))
  },
  {
    path: '/profile-lab/new',
    component: lazyLoad(() => import('./screens/profile-lab/ProfileLabCreate').then((m) => ({ default: m.ProfileLabCreate })))
  },
  {
    path: '/profile-lab/:profileId/edit',
    component: lazyLoad(() => import('./screens/profile-lab/ProfileLabEdit').then((m) => ({ default: m.ProfileLabEdit })))
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
