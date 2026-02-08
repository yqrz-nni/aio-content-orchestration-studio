/* 
* <license header>
*/

import React from 'react'
import { Provider, defaultTheme, Grid, View } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import { ImsContext } from "../context/ImsContext";
import { GqlDemo } from "../screens/GqlDemo";
import { VfDemo } from "../screens/VfDemo";
import { AjoCreateTemplate } from '../screens/AjoCreateTemplate';
import { TemplateStudio } from "../screens/TemplateStudio";


function App (props) {
  console.log('runtime object:', props.runtime)
  console.log('ims object:', props.ims)

  // use exc runtime event handlers
  // respond to configuration change events (e.g. user switches org)
  props.runtime.on('configuration', ({ imsOrg, imsToken, locale }) => {
    console.log('configuration change', { imsOrg, imsToken, locale })
  })
  // respond to history change events
  props.runtime.on('history', ({ type, path }) => {
    console.log('history change', { type, path })
  })

  return (
    <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
      <Router>
        <Provider theme={defaultTheme} colorScheme={'light'}>
          <ImsContext.Provider value={props.ims}>
            <View padding="size-200">
              <GqlDemo />
            </View>
            <View padding="size-200">
              <VfDemo />
            </View>
            <View padding="size-200">
              <AjoCreateTemplate />
            </View>
            <View padding="size-200">
              <TemplateStudio />
            </View>
          </ImsContext.Provider>
        </Provider>
      </Router>
    </ErrorBoundary>
  )

  // Methods

  // error handler on UI rendering failure
  function onError (e, componentStack) { }

  // component to show if UI fails rendering
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
