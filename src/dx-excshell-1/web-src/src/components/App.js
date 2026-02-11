/* 
* <license header>
*/

import React from 'react'
import { Provider, defaultTheme, View, Flex, Text } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { ImsContext } from "../context/ImsContext";

import { PrbSelect } from "../screens/PrbSelect";
import { TemplateSelect } from "../screens/TemplateSelect";
import { TemplateStudio } from "../screens/TemplateStudio";
import { TemplateFlow } from "../screens/TemplateFlow";

function App (props) {
  // eslint-disable-next-line no-console
  console.log('runtime object:', props.runtime)
  // eslint-disable-next-line no-console
  console.log('ims object:', props.ims)

  props.runtime.on('configuration', ({ imsOrg, imsToken, locale }) => {
    // eslint-disable-next-line no-console
    console.log('configuration change', { imsOrg, imsToken, locale })
  })

  props.runtime.on('history', ({ type, path }) => {
    // eslint-disable-next-line no-console
    console.log('history change', { type, path })
  })

  return (
    <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
      <Router>
        <Provider theme={defaultTheme} colorScheme={'light'}>
          <ImsContext.Provider value={props.ims}>
            <View UNSAFE_className="AppShell">
              <Flex UNSAFE_className="AppHeader" alignItems="center" justifyContent="space-between" wrap>
                <View>
                  <Text UNSAFE_className="AppTitle">Content Orchestration Studio</Text>
                  <Text UNSAFE_className="AppSubtle">AJO + AEM preview sandbox</Text>
                </View>
                <View>
                  <Text UNSAFE_className="AppMeta">Org: {props?.ims?.org || 'unknown'}</Text>
                </View>
              </Flex>

              <View UNSAFE_className="AppMain">
              <Routes>
                {/* Unified flow as default */}
                <Route path="/" element={<Navigate to="/flow" replace />} />

                {/* Unified single-screen flow */}
                <Route path="/flow" element={<TemplateFlow />} />

                {/* Keep existing deep-link routes */}
                <Route path="/prb" element={<PrbSelect />} />
                <Route path="/prb/:prbId/templates" element={<TemplateSelect />} />
                <Route path="/prb/:prbId/templates/:templateId/studio" element={<TemplateStudio />} />

                <Route path="*" element={<Navigate to="/prb" replace />} />
              </Routes>
              </View>
            </View>
          </ImsContext.Provider>
        </Provider>
      </Router>
    </ErrorBoundary>
  )

  function onError (e, componentStack) { }

  function fallbackComponent ({ componentStack, error }) {
    return (
      <React.Fragment>
        <h1 style={{ textAlign: 'center', marginTop: '20px' }}>
          Something went wrong :(
        </h1>
        <pre>{componentStack + '\n' + error.message}</pre>
      </React.Fragment>
    )
  }
}

export default App
