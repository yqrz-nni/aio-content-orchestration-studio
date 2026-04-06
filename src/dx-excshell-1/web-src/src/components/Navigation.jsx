import React from 'react'
import { Flex, ActionButton } from '@adobe/react-spectrum'
import { NavLink } from 'react-router-dom'
import { appNavRoutes } from '../routes'

export function Navigation () {
  return (
    <Flex gap="size-100" margin="size-100" alignItems="center">
      {appNavRoutes.map((route) => (
        <NavLink
          key={route.path}
          to={route.path}
          className={({ isActive }) =>
            `AppNavLink ${isActive ? 'AppNavLinkActive' : 'AppNavLinkInactive'}`
          }
          style={{ textDecoration: 'none' }}
        >
          {({ isActive }) => (
            <ActionButton isQuiet isEmphasized={isActive} marginBottom="size-0">
              {route.label}
            </ActionButton>
          )}
        </NavLink>
      ))}
    </Flex>
  )
}
