import { ServiceProvider } from 'pcf-react'
import React = require('react');

export const ServiceProviderContext = React.createContext<ServiceProvider>(new ServiceProvider())
