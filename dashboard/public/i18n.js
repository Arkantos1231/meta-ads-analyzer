/**
 * i18n.js — Internationalization module
 * Supported languages: 'en' (default), 'es'
 */

const translations = {
  en: {
    // Header
    account: 'Account',
    date_range: 'Date range',
    last_7d: 'Last 7 days',
    last_30d: 'Last 30 days',
    last_90d: 'Last 90 days',
    last_24m: 'Last 24 months',
    last_36m: 'Last 36 months',
    refresh: '↻ Refresh',
    loading_accounts: 'Loading accounts…',
    select_account: '— Select account —',
    no_accounts: 'No accounts found',
    error_loading_accounts: 'Error loading accounts',

    // Summary cards
    total_spend: 'Total Spend',
    purchase_roas: 'Purchase ROAS',
    purchases: 'Purchases',
    weighted_by_spend: 'Weighted by spend',
    weighted_avg_cpm: 'Weighted avg CPM',

    // Table section titles
    campaigns: 'Campaigns',
    ads: 'Ads',
    ad_sets: 'Ad Sets',
    breakdown_by_placement: 'Breakdown by Placement',
    ai_recommendations: 'AI Recommendations',

    // Table headers
    campaign: 'Campaign',
    status: 'Status',
    objective: 'Objective',
    spend: 'Spend',
    impressions: 'Impressions',
    clicks: 'Clicks',
    ad: 'Ad',
    ad_set: 'Ad Set',
    reach: 'Reach',
    rev: 'Rev',
    platform: 'Platform',
    placement: 'Placement',

    // Status badges
    badge_active: 'Active',
    badge_paused: 'Paused',
    badge_learning: 'Learning',
    badge_learning_limited: 'Learning Limited',
    badge_out_of_learning: 'Out of Learning',
    badge_graduated: 'Graduated',

    // Empty / loading rows
    select_account_to_load: 'Select an account to load data.',
    no_campaigns: 'No campaigns found.',
    no_ads: 'No ad data for selected period.',
    no_adsets: 'No ad sets found.',
    no_placements: 'No placement data for selected period.',
    loading: 'Loading…',

    // Filter tag
    filtered: 'Filtered',

    // AI sidebar
    ai_placeholder: 'Select a campaign, then click a button above.',
    ai_campaign_selected: 'Campaign selected — use a button above to generate AI analysis.',
    ai_generate: '✦ Generate Recommendations',
    ai_report: '📄 Generate PDF Report',
    ai_generating: '⏳ Generating report…',
    ai_analyzing: 'Analyzing campaign performance…',

    // Footer
    powered_by: 'Powered by Windsor.ai',
    data_refreshed: 'Data refreshed',

    // Settings modal
    settings_title: 'Settings',
    tab_profile: 'Profile',
    tab_connection: 'Connection',
    tab_admin: 'Admin',

    // Profile pane
    change_password: 'Change Password',
    current_password: 'Current password',
    new_password: 'New password',
    min_8_chars: '(min 8 chars)',
    confirm_password: 'Confirm new password',
    update_password: 'Update Password',

    // Connection pane
    windsor_connection: 'Windsor Connection',
    no_accounts_connected: 'No accounts connected',
    add_account: '+ Add account',
    disconnect_all: 'Disconnect all',
    connect_meta: 'Connect Meta Ads account',
    connect_hint: 'Connect your Meta Ads account through Windsor. A new tab will open.',
    link_opened: '✅ Link opened. Complete the connection in Windsor, then come back here.',
    contact_admin: 'Your admin has shared a Windsor connection link with you. After connecting your Meta Ads account, click below to add it here.',
    check_accounts: 'Check for my accounts',
    select_meta_account: 'Select your Meta Ads account',
    confirm: 'Confirm',
    back: '← Back',

    // Admin pane
    users: 'Users',
    generate_link_btn: '🔗 Generate connection link',
    col_username: 'Username',
    col_email: 'Email',
    col_role: 'Role',
    col_windsor: 'Windsor',
    col_actions: 'Actions',
    create_user: 'Create User',
    label_username: 'Username',
    label_email: 'Email',
    label_password: 'Password',
    label_role: 'Role',
    role_user: 'User',
    role_admin: 'Admin',
    btn_create_user: 'Create User',
    btn_add: '+ Add',
    btn_reset_pwd: 'Reset pwd',
    btn_delete: 'Delete',
    no_users: 'No users found.',
    none_assigned: '✗ None',

    // Feedback messages
    all_fields_required: 'All fields are required.',
    passwords_no_match: 'New passwords do not match.',
    password_min_8: 'Password must be at least 8 characters.',
    password_updated: 'Password updated.',
    disconnect_all_confirm: 'Disconnect all Meta Ads accounts?',
    delete_user_confirm: 'Delete user "%s"? This cannot be undone.',
    user_deleted: 'User "%s" deleted.',
    account_assigned: 'Account assigned.',
    account_connected: 'Account "%s" connected!',
    all_disconnected: 'All accounts disconnected.',
    user_created: 'User "%s" created.',
    new_password_prompt: 'New password for "%s" (min 8 chars):',
    password_reset: 'Password reset for "%s".',
    no_new_accounts: 'No new accounts found. Make sure you completed the connection in Windsor and try again.',
    remove_account_confirm: 'Remove account "%s"?',
    link_copied: 'Link copied to clipboard! Send it to the client to connect their Meta Ads account.',
    verifying: 'Verifying…',
    generating_link: '⏳ Generating…',
    failed_campaigns: 'Failed to load campaigns',
    failed_ads: 'Failed to load ads',
    failed_adsets: 'Failed to load ad sets',
    failed_placements: 'Failed to load placement data',
    popup_blocked: 'Pop-up blocked. Please allow pop-ups for this page and try again.',
    error_prefix: 'Error',

    // Report
    report_title: 'Campaign Performance Report',
    report_period: 'Period',
    report_generated: 'Generated',
    report_print: '🖨 Print / Save as PDF',
    report_footer: 'Generated by Meta Ads Dashboard · Powered by AI',

    // Login
    sign_in_title: 'Sign In — Meta Ads Dashboard',
    label_username_login: 'Username',
    label_password_login: 'Password',
    btn_sign_in: 'Sign in',
    signing_in: 'Signing in…',
    login_failed: 'Login failed. Check your username and password.',
    network_error: 'Network error — is the server running?',

    // Language toggle
    lang_toggle_title: 'Switch to Spanish',
  },

  es: {
    // Header
    account: 'Cuenta',
    date_range: 'Período',
    last_7d: 'Últimos 7 días',
    last_30d: 'Últimos 30 días',
    last_90d: 'Últimos 90 días',
    last_24m: 'Últimos 24 meses',
    last_36m: 'Últimos 36 meses',
    refresh: '↻ Actualizar',
    loading_accounts: 'Cargando cuentas…',
    select_account: '— Seleccionar cuenta —',
    no_accounts: 'No se encontraron cuentas',
    error_loading_accounts: 'Error al cargar cuentas',

    // Summary cards
    total_spend: 'Gasto Total',
    purchase_roas: 'ROAS de Compras',
    purchases: 'Compras',
    weighted_by_spend: 'Ponderado por gasto',
    weighted_avg_cpm: 'CPM promedio ponderado',

    // Table section titles
    campaigns: 'Campañas',
    ads: 'Anuncios',
    ad_sets: 'Conjuntos de Anuncios',
    breakdown_by_placement: 'Desglose por Ubicación',
    ai_recommendations: 'Recomendaciones IA',

    // Table headers
    campaign: 'Campaña',
    status: 'Estado',
    objective: 'Objetivo',
    spend: 'Gasto',
    impressions: 'Impresiones',
    clicks: 'Clics',
    ad: 'Anuncio',
    ad_set: 'Conj. Anuncios',
    reach: 'Alcance',
    rev: 'Ingresos',
    platform: 'Plataforma',
    placement: 'Ubicación',

    // Status badges
    badge_active: 'Activo',
    badge_paused: 'Pausado',
    badge_learning: 'Aprendizaje',
    badge_learning_limited: 'Aprendizaje Limitado',
    badge_out_of_learning: 'Fuera de Aprendizaje',
    badge_graduated: 'Graduado',

    // Empty / loading rows
    select_account_to_load: 'Selecciona una cuenta para cargar datos.',
    no_campaigns: 'No se encontraron campañas.',
    no_ads: 'Sin datos de anuncios para el período seleccionado.',
    no_adsets: 'No se encontraron conjuntos de anuncios.',
    no_placements: 'Sin datos de ubicación para el período seleccionado.',
    loading: 'Cargando…',

    // Filter tag
    filtered: 'Filtrado',

    // AI sidebar
    ai_placeholder: 'Selecciona una campaña, luego usa un botón arriba.',
    ai_campaign_selected: 'Campaña seleccionada — usa un botón arriba para generar análisis IA.',
    ai_generate: '✦ Generar Recomendaciones',
    ai_report: '📄 Generar Reporte PDF',
    ai_generating: '⏳ Generando reporte…',
    ai_analyzing: 'Analizando rendimiento de campaña…',

    // Footer
    powered_by: 'Powered by Windsor.ai',
    data_refreshed: 'Datos actualizados',

    // Settings modal
    settings_title: 'Configuración',
    tab_profile: 'Perfil',
    tab_connection: 'Conexión',
    tab_admin: 'Admin',

    // Profile pane
    change_password: 'Cambiar Contraseña',
    current_password: 'Contraseña actual',
    new_password: 'Nueva contraseña',
    min_8_chars: '(mín. 8 caracteres)',
    confirm_password: 'Confirmar nueva contraseña',
    update_password: 'Actualizar Contraseña',

    // Connection pane
    windsor_connection: 'Conexión Windsor',
    no_accounts_connected: 'No hay cuentas conectadas',
    add_account: '+ Agregar cuenta',
    disconnect_all: 'Desconectar todo',
    connect_meta: 'Conectar cuenta de Meta Ads',
    connect_hint: 'Conecta tu cuenta de Meta Ads a través de Windsor. Se abrirá una pestaña nueva.',
    link_opened: '✅ Link abierto. Completa la conexión en Windsor y regresa aquí.',
    contact_admin: 'Tu administrador compartió un link de conexión contigo. Después de conectar tu cuenta de Meta Ads, haz clic abajo.',
    check_accounts: 'Verificar mis cuentas',
    select_meta_account: 'Selecciona tu cuenta de Meta Ads',
    confirm: 'Confirmar',
    back: '← Atrás',

    // Admin pane
    users: 'Usuarios',
    generate_link_btn: '🔗 Generar link de conexión',
    col_username: 'Usuario',
    col_email: 'Email',
    col_role: 'Rol',
    col_windsor: 'Windsor',
    col_actions: 'Acciones',
    create_user: 'Crear Usuario',
    label_username: 'Usuario',
    label_email: 'Email',
    label_password: 'Contraseña',
    label_role: 'Rol',
    role_user: 'Usuario',
    role_admin: 'Admin',
    btn_create_user: 'Crear Usuario',
    btn_add: '+ Agregar',
    btn_reset_pwd: 'Cambiar pwd',
    btn_delete: 'Eliminar',
    no_users: 'No se encontraron usuarios.',
    none_assigned: '✗ Ninguna',

    // Feedback messages
    all_fields_required: 'Todos los campos son requeridos.',
    passwords_no_match: 'Las contraseñas nuevas no coinciden.',
    password_min_8: 'La contraseña debe tener al menos 8 caracteres.',
    password_updated: 'Contraseña actualizada.',
    disconnect_all_confirm: '¿Desconectar todas las cuentas de Meta Ads?',
    delete_user_confirm: '¿Eliminar usuario "%s"? Esta acción no se puede deshacer.',
    user_deleted: 'Usuario "%s" eliminado.',
    account_assigned: 'Cuenta asignada.',
    account_connected: '¡Cuenta "%s" conectada!',
    all_disconnected: 'Todas las cuentas desconectadas.',
    user_created: 'Usuario "%s" creado.',
    new_password_prompt: 'Nueva contraseña para "%s" (mín. 8 caracteres):',
    password_reset: 'Contraseña restablecida para "%s".',
    no_new_accounts: 'No se encontraron cuentas nuevas. Asegurate de haber completado la conexión en Windsor e intentá de nuevo.',
    remove_account_confirm: '¿Eliminar cuenta "%s"?',
    link_copied: '¡Link copiado al portapapeles! Envíalo al cliente para que conecte su cuenta de Meta Ads.',
    verifying: 'Verificando…',
    generating_link: '⏳ Generando…',
    failed_campaigns: 'Error al cargar campañas',
    failed_ads: 'Error al cargar anuncios',
    failed_adsets: 'Error al cargar conjuntos de anuncios',
    failed_placements: 'Error al cargar datos de ubicación',
    popup_blocked: 'Pop-up bloqueado. Permite los pop-ups para esta página e intenta de nuevo.',
    error_prefix: 'Error',

    // Report
    report_title: 'Reporte de Rendimiento de Campaña',
    report_period: 'Período',
    report_generated: 'Generado',
    report_print: '🖨 Imprimir / Guardar como PDF',
    report_footer: 'Generado por Meta Ads Dashboard · Impulsado por IA',

    // Login
    sign_in_title: 'Iniciar Sesión — Meta Ads Dashboard',
    label_username_login: 'Usuario',
    label_password_login: 'Contraseña',
    btn_sign_in: 'Iniciar sesión',
    signing_in: 'Iniciando sesión…',
    login_failed: 'Error de inicio de sesión. Verifica tu usuario y contraseña.',
    network_error: 'Error de red — ¿está el servidor ejecutándose?',

    // Language toggle
    lang_toggle_title: 'Switch to English',
  },
};

let _lang = localStorage.getItem('dashboard-lang') || 'en';

export function getLang() {
  return _lang;
}

/**
 * Translate a key, replacing %s with interpolated args in order.
 */
export function t(key, ...args) {
  const str =
    (translations[_lang] || translations.en)[key] ||
    translations.en[key] ||
    key;
  return args.reduce((s, arg) => s.replace('%s', String(arg)), str);
}

/**
 * Change language, persist to localStorage, and update all [data-i18n] elements.
 */
export function setLang(lang) {
  if (!translations[lang]) return;
  _lang = lang;
  localStorage.setItem('dashboard-lang', lang);
  applyI18n();
}

/**
 * Update all elements that have a [data-i18n] attribute.
 * Elements with [data-i18n-html] get innerHTML instead.
 * Elements with [data-i18n-placeholder] get their placeholder attribute updated.
 */
export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });

  // Update <title> on login page if present
  const titleKey = document.documentElement.dataset.i18nTitle;
  if (titleKey) document.title = t(titleKey);
}
