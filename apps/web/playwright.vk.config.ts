import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, testMatch:['**/vk.compat.ts','**/vk.spec.ts'] });
