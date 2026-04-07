import React, { Suspense, useEffect } from 'react'
import { Provider, defaultTheme, View, ProgressCircle, Text } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ImsContext } from '../context/ImsContext'
import { Navigation } from './Navigation'
import { appRouteConfig } from '../routes'

function AppShell (props) {
  useEffect(() => {
    if (!props.runtime) return

    props.runtime.on('configuration', ({ imsOrg, imsToken, locale }) => {
      console.log('configuration change', { imsOrg, imsToken, locale })
    })

    props.runtime.on('history', ({ type, path }) => {
      console.log('history change', { type, path })
    })

    return () => {
      // no cleanup API available on runtime object for this app at the moment
    }
  }, [props.runtime])

  return (
    <ErrorBoundary fallbackRender={({ error }) => <div>App error: {error.message}</div>}>
      <Router>
        <Provider theme={defaultTheme} colorScheme="light">
          <ImsContext.Provider value={props.ims}>
            <View>
              <View margin="size-100">
                <Text>Org: {props?.ims?.org || 'unknown'}</Text>
              </View>
              <Navigation />
              <View margin="size-100">
                <Suspense fallback={<ProgressCircle size="S" aria-label="Loading" />}> 
                  <Routes>
                    <Route path="/" element={<Navigate to="/flow" replace />} />
                    {appRouteConfig.map((route) => (
                      <Route key={route.path} path={route.path} element={<route.component />} />
                    ))}
                    <Route path="*" element={<Navigate to="/flow" replace />} />
                  </Routes>
                </Suspense>
              </View>
            </View>
          </ImsContext.Provider>
        </Provider>
      </Router>
    </ErrorBoundary>
  )
}

export default AppShell
