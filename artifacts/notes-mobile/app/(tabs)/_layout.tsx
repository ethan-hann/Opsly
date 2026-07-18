import React from 'react';
import { Stack } from 'expo-router';

// Notes app has no tabs — render a plain Stack so expo-router's
// (tabs) route group works without an actual tab bar.
export default function Layout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
