// AuthService - Pour votre API personnalisée Odoo-RPC
import authStorageService from './authStorageService';
import {
    AUTH_PAYLOADS,
    CONFIG_UTILS,
    getCurrentApiUrl,
    updateServerConfig,
    updateServerConfigFromServerResponse,
    fetchServerConfig,
    initializeConfig,
    type PayloadCredentials,
    type CustomAuthResponse,
    type ServerConfigResponse
} from "./config/configService";

// Interface pour la session stockée
interface UserAuthSession {
    success: boolean;
    user_info: AuthUser;
    CREDENTIALS: {
        username: string;
        password: string;
    };
    db: string;
    server_url: string;
    timestamp: number;
}

export interface AuthUser {
    id: number;
    uid: number;
    balance: number;
    display_name: string;
    case_id: number;
    username: string;
    user_name: string;
    employee_id: string;
    email: string;
    phone?: string;
    mobile?: string;
    partner_id: number; // 🆕 Partner ID pour le filtrage privacy_visibility
    partner_name: string;
    city?: string;
    company_name?: string;
    is_admin?: boolean;
    image_url?: string;
}

export interface AuthResponse {
    success: boolean;
    message: string;
    user_info: AuthUser;
    CREDENTIALS?: {
        username: string;
        password: string;
    };
}

export interface LoginCredentials {
    username: string;
    password: string;
    db: string;
    server_url: string;
}

// Configuration SQLite Storage - Sessions illimitées
const STORAGE_KEYS = {
    SESSION: '@geo_lambert_session_v4',
    CREDENTIALS: '@geo_lambert_credentials_v4',
    USER_INFO: '@geo_lambert_user_info_v4',
    SERVER_CONFIG: '@geo_lambert_server_config'
};

// ==================== STORAGE HELPERS ====================

async function saveToStorage(key: string, value: any): Promise<boolean> {
    try {
        await authStorageService.save(key, value);
        return true;
    } catch (error) {
        console.error(`❌ Erreur sauvegarde Storage ${key}:`, error);
        return false;
    }
}

async function getFromStorage(key: string): Promise<any | null> {
    try {
        return await authStorageService.get(key);
    } catch (error) {
        console.error(`❌ Erreur récupération Storage ${key}:`, error);
        return null;
    }
}

// ==================== SERVICE D'AUTHENTIFICATION ====================

export const authService = {
    /**
     * ✅ ÉTAPE 1: Récupération de la configuration serveur
     */
    async fetchAndConfigureServer(serverUrl: string): Promise<{
        success: boolean;
        config?: ServerConfigResponse;
        error?: string
    }> {
        try {
            const cleanUrl = CONFIG_UTILS.formatServerUrl(serverUrl);

            if (!CONFIG_UTILS.isValidUrl(cleanUrl)) {
                throw new Error('URL de serveur invalide');
            }

            console.log('🔍 Étape 1: Récupération config serveur...', cleanUrl);

            // Récupérer la configuration depuis le serveur
            const serverConfig = await fetchServerConfig(cleanUrl);

            if (!serverConfig.success || !serverConfig.form.baseUrl) {
                throw new Error('Configuration serveur invalide ou baseUrl manquant');
            }

            // Mettre à jour la configuration avec le baseUrl et wsUrl récupérés
            await updateServerConfigFromServerResponse(
                cleanUrl,
                serverConfig.form.baseUrl,
                serverConfig.form.wsUrl
            );
            await saveToStorage(STORAGE_KEYS.SERVER_CONFIG, {
                server_url: cleanUrl,
                base_url: serverConfig.form.baseUrl,
                ws_url: serverConfig.form.wsUrl,
                odoo_version: serverConfig.odoo_version,
                api_version: serverConfig.api_version,
                configured_at: Date.now()
            });

            console.log('✅ Étape 1 terminée - Serveur configuré:', {
                serverUrl: cleanUrl,
                baseUrl: serverConfig.form.baseUrl
            });

            return {success: true, config: serverConfig};

        } catch (error) {
            console.error('❌ Erreur configuration serveur:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Erreur de configuration serveur'
            };
        }
    },

    /**
     * ✅ ÉTAPE 2: AUTHENTIFICATION avec votre API personnalisée (Flow complet en 2 étapes)
     */
    async authenticate(credentials: LoginCredentials): Promise<AuthResponse> {
        try {
            // ÉTAPE 1: Configurer le serveur et récupérer la configuration
            console.log('🚀 Début authentification en 2 étapes...');
            const configResult = await this.fetchAndConfigureServer(credentials.server_url);

            if (!configResult.success) {
                return {
                    success: false,
                    message: configResult.error || 'Impossible de configurer le serveur',
                    user_info: {} as AuthUser
                };
            }

            console.log('✅ Étape 1 terminée - Configuration récupérée');

            // ÉTAPE 2: Authentification avec le baseUrl récupéré
            console.log('🔐 Étape 2: Authentification...');

            // Créer le payload pour votre API
            const authPayload = AUTH_PAYLOADS.authenticate(
                credentials.username,
                credentials.password,
                credentials.db
            );

            console.log('🔐 Payload d\'authentification:', authPayload);

            // Utiliser l'URL API configurée depuis la réponse du serveur
            const apiUrl = getCurrentApiUrl();
            console.log('🔗 URL API pour auth:', apiUrl);

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: CONFIG_UTILS.createDefaultHeaders(),
                body: JSON.stringify(authPayload),
            });

            if (!response.ok) {
                // ❌ Gérer spécifiquement les erreurs HTTP
                if (response.status === 401) {
                    throw new Error('Identifiants incorrects. Vérifiez votre nom d\'utilisateur et mot de passe.');
                } else if (response.status === 403) {
                    throw new Error('Accès refusé. Vous n\'avez pas les permissions nécessaires.');
                } else if (response.status === 404) {
                    throw new Error('Service d\'authentification non trouvé. Vérifiez l\'URL du serveur.');
                } else if (response.status >= 500) {
                    throw new Error('Erreur serveur. Le serveur rencontre des difficultés.');
                } else {
                    throw new Error(`Erreur ${response.status}: ${response.statusText}`);
                }
            }

            const data: CustomAuthResponse = await response.json();

            console.log('📥 Réponse authentification reçue:', {
                success: data.success,
                message: data.message,
                user: data.user_info?.display_name || 'N/A'
            });

            // Gestion de votre format de réponse
            if (data.success && data.user_info) {
                const authResponse: AuthResponse = {
                    success: true,
                    message: data.message || 'Connexion réussie',
                    user_info: {
                        id: data.user_info.id,
                        uid: data.user_info.uid,
                        employee_id: data.user_info.employee_id,
                        balance: data.user_info.balance,
                        case_id: data.user_info.case_id,
                        display_name: data.user_info.display_name,
                        username: data.user_info.username,
                        user_name: data.user_info.user_name,
                        email: data.user_info.email,
                        phone: data.user_info.phone,
                        mobile: data.user_info.mobile,
                        partner_id: data.user_info.partner_id, // 🆕 Partner ID pour le filtrage privacy_visibility
                        partner_name: data.user_info.partner_name,
                        city: data.user_info.city,
                        company_name: data.user_info.company_name,
                        is_admin: data.user_info.is_admin,
                        image_url: data.user_info.image_url
                    },
                    CREDENTIALS: {
                        username: credentials.username,
                        password: credentials.password
                    }
                };

                // Sauvegarder les données
                try {
                    await this.saveAuthData(authResponse, credentials.db, credentials.server_url);
                    await this.saveCredentials({
                        username: credentials.username,
                        password: credentials.password,
                        db: credentials.db,
                        server_url: credentials.server_url
                    });

                    console.log('✅ Données d\'authentification sauvegardées');
                } catch (saveError) {
                    console.warn('⚠️ Erreur sauvegarde après auth:', saveError);
                }

                console.log('🎉 Authentification complète terminée avec succès!');
                return authResponse;
            } else {
                console.warn('⚠️ Authentification échouée:', data.message);

                // ❌ Ne PAS sauvegarder de données invalides
                // Le UserAuthContext va nettoyer le storage

                return {
                    success: false,
                    message: data.message || 'Identifiants incorrects. Vérifiez votre nom d\'utilisateur et mot de passe.',
                    user_info: {} as AuthUser
                };
            }

        } catch (error) {
            // ❌ Gérer les erreurs silencieusement sans logs excessifs

            if (error instanceof Error) {
                // Si le message contient déjà une explication claire (nos erreurs personnalisées)
                if (error.message.includes('Identifiants incorrects') ||
                    error.message.includes('Accès refusé') ||
                    error.message.includes('Service d\'authentification') ||
                    error.message.includes('Erreur serveur')) {
                    return {
                        success: false,
                        message: error.message,
                        user_info: {} as AuthUser
                    };
                }

                // Erreurs de réseau
                if (error.message.includes('fetch') ||
                    error.message.includes('Network') ||
                    error.message.includes('Failed to fetch')) {
                    return {
                        success: false,
                        message: 'Impossible de se connecter au serveur.\n\nVérifiez votre connexion internet et l\'URL du serveur.',
                        user_info: {} as AuthUser
                    };
                }

                // Timeout
                if (error.message.includes('timeout') || error.message.includes('Timeout')) {
                    return {
                        success: false,
                        message: 'Le serveur met trop de temps à répondre.\n\nVérifiez votre connexion.',
                        user_info: {} as AuthUser
                    };
                }
            }

            // Erreur générique
            return {
                success: false,
                message: 'Erreur de connexion au serveur.\n\nVeuillez réessayer.',
                user_info: {} as AuthUser
            };
        }
    },

    /**
     * ✅ SAUVEGARDE: AuthData
     */
    async saveAuthData(authData: AuthResponse, db: string, serverUrl: string): Promise<void> {
        try {
            const sessionData: UserAuthSession = {
                success: authData.success,
                user_info: authData.user_info,
                CREDENTIALS: authData.CREDENTIALS || {username: '', password: ''},
                db,
                server_url: serverUrl,
                timestamp: Date.now()
            };

            await saveToStorage(STORAGE_KEYS.SESSION, sessionData);
        } catch (error) {
            console.error('❌ Erreur saveAuthData:', error);
            throw error;
        }
    },

    /**
     * ✅ SAUVEGARDE: Credentials
     */
    async saveCredentials(credentials: {
        username: string;
        password: string;
        db: string;
        server_url: string;
    }): Promise<void> {
        try {
            await saveToStorage(STORAGE_KEYS.CREDENTIALS, credentials);
        } catch (error) {
            console.error('❌ Erreur saveCredentials:', error);
            throw error;
        }
    },

    /**
     * ✅ RÉCUPÉRATION: Credentials
     */
    async getStoredCredentials(): Promise<{
        username: string;
        password: string;
        db: string;
        server_url: string;
    } | null> {
        try {
            const credentials = await getFromStorage(STORAGE_KEYS.CREDENTIALS);

            if (credentials && credentials.username && credentials.password && credentials.server_url) {
                return credentials;
            }

            const sessionData = await getFromStorage(STORAGE_KEYS.SESSION);

            if (sessionData && sessionData.CREDENTIALS && sessionData.CREDENTIALS.username) {
                return {
                    username: sessionData.CREDENTIALS.username,
                    password: sessionData.CREDENTIALS.password,
                    db: sessionData.db || 'smile_piscine',
                    server_url: sessionData.server_url || ''
                };
            }

            return null;

        } catch (error) {
            console.error('❌ Erreur getStoredCredentials:', error);
            return null;
        }
    },

    /**
     * ✅ VÉRIFICATION: Session authentifiée
     */
    async isAuthenticated(): Promise<boolean> {
        try {
            const credentials = await this.getStoredCredentials();

            if (credentials && credentials.username && credentials.password && credentials.server_url) {
                // Reconfigurer le serveur avec updateServerConfig simple
                try {
                    const serverConfig = await getFromStorage(STORAGE_KEYS.SERVER_CONFIG);
                    if (serverConfig && serverConfig.base_url && serverConfig.ws_url) {
                        await updateServerConfig(serverConfig.base_url, serverConfig.ws_url);
                    } else {
                        // Fallback: essayer de récupérer la config depuis le serveur
                        console.log('⚠️ Config manquante, tentative de récupération depuis le serveur...');
                        const configResult = await this.fetchAndConfigureServer(credentials.server_url);
                        if (!configResult.success) {
                            throw new Error('Configuration serveur impossible');
                        }
                    }
                } catch (configError) {
                    console.warn('⚠️ Erreur reconfiguration dans isAuthenticated:', configError);
                }
                return true;
            }

            return false;

        } catch (error) {
            console.error('❌ Erreur isAuthenticated:', error);
            return false;
        }
    },

    /**
     * ✅ RÉCUPÉRATION: Données d'auth
     */
    async getStoredAuthData(): Promise<AuthResponse | null> {
        try {
            const sessionData = await getFromStorage(STORAGE_KEYS.SESSION);

            if (sessionData && sessionData.user_info) {
                if (sessionData.server_url) {
                    try {
                        const serverConfig = await getFromStorage(STORAGE_KEYS.SERVER_CONFIG);
                        if (serverConfig && serverConfig.base_url && serverConfig.ws_url) {
                            await updateServerConfig(serverConfig.base_url, serverConfig.ws_url);
                        } else {
                            // Fallback: récupérer la config depuis le serveur
                            console.log('⚠️ Config manquante, tentative de récupération depuis le serveur...');
                            const configResult = await this.fetchAndConfigureServer(sessionData.server_url);
                            if (!configResult.success) {
                                console.warn('⚠️ Impossible de récupérer la config serveur');
                            }
                        }
                    } catch (configError) {
                        console.warn('⚠️ Erreur reconfiguration dans getStoredAuthData:', configError);
                    }
                }

                return {
                    success: sessionData.success,
                    message: 'Session active',
                    user_info: sessionData.user_info,
                    CREDENTIALS: sessionData.CREDENTIALS
                };
            }

            return null;

        } catch (error) {
            console.error('❌ Erreur getStoredAuthData:', error);
            return null;
        }
    },

    /**
     * ✅ UTILISATEUR: Récupération
     */
    async getCurrentUser(): Promise<AuthUser | null> {
        try {
            const authData = await this.getStoredAuthData();
            return authData?.user_info || null;
        } catch (error) {
            console.error('❌ Erreur getCurrentUser:', error);
            return null;
        }
    },

    /**
     * ✅ VÉRIFICATION: Session valide
     */
    async isSessionValid(): Promise<boolean> {
        try {
            const sessionData = await getFromStorage(STORAGE_KEYS.SESSION);
            const credentials = await this.getStoredCredentials();

            return (
                sessionData &&
                sessionData.success &&
                sessionData.user_info &&
                credentials &&
                credentials.username &&
                credentials.password
            );

        } catch (error) {
            console.error('❌ Erreur isSessionValid:', error);
            return false;
        }
    },

    /**
     * ✅ DÉCONNEXION: Nettoyage
     */
    async logout(): Promise<void> {
        try {
            await authStorageService.multiRemove([
                STORAGE_KEYS.SESSION,
                STORAGE_KEYS.CREDENTIALS,
                STORAGE_KEYS.USER_INFO,
                STORAGE_KEYS.SERVER_CONFIG
            ]);

            console.log('✅ Déconnexion réussie');

        } catch (error) {
            console.error('❌ Erreur logout:', error);
        }
    },

    /**
     * ✅ INITIALISATION: Au démarrage
     */
    async initializeAuth(): Promise<boolean> {
        try {
            await initializeConfig();

            const isAuth = await this.isAuthenticated();

            if (isAuth) {
                console.log('✅ Session utilisateur restaurée');
            } else {
                console.log('⚠️ Aucune session active');
            }

            return isAuth;

        } catch (error) {
            console.error('❌ Erreur initializeAuth:', error);
            return false;
        }
    },

    /**
     * ✅ MISE À JOUR: Données utilisateur depuis WebSocket
     */
    async updateUserFromWebSocket(userData: any): Promise<boolean> {
        try {
            console.log('🔄 Mise à jour des données utilisateur depuis WebSocket...');
            
            // Récupérer la session actuelle
            const currentSession = await getFromStorage(STORAGE_KEYS.SESSION);
            if (!currentSession) {
                console.warn('⚠️ Aucune session à mettre à jour');
                return false;
            }

            // Mettre à jour les données utilisateur
            const updatedUserInfo: AuthUser = {
                ...currentSession.user_info,
                // Mettre à jour les champs qui peuvent changer
                display_name: userData.display_name || userData.name || currentSession.user_info.display_name,
                balance: userData.balance !== undefined ? userData.balance : currentSession.user_info.balance,
                case_id: userData.case_id !== undefined ? userData.case_id : currentSession.user_info.case_id,
                email: userData.email || currentSession.user_info.email,
                phone: userData.phone || currentSession.user_info.phone,
                mobile: userData.mobile || currentSession.user_info.mobile,
                city: userData.city || currentSession.user_info.city,
                company_name: userData.company_name || currentSession.user_info.company_name,
                image_url: userData.image_url || currentSession.user_info.image_url,
                // Les IDs ne changent pas
                id: currentSession.user_info.id,
                uid: currentSession.user_info.uid,
                employee_id: currentSession.user_info.employee_id,
                username: currentSession.user_info.username,
                user_name: currentSession.user_info.user_name,
                partner_id: currentSession.user_info.partner_id,
                partner_name: userData.partner_name || currentSession.user_info.partner_name,
                is_admin: userData.is_admin !== undefined ? userData.is_admin : currentSession.user_info.is_admin,
            };

            // Mettre à jour la session avec les nouvelles données
            const updatedSession: UserAuthSession = {
                ...currentSession,
                user_info: updatedUserInfo,
                timestamp: Date.now()
            };

            // Sauvegarder la session mise à jour
            await saveToStorage(STORAGE_KEYS.SESSION, updatedSession);
            
            console.log('✅ Données utilisateur mises à jour avec succès:', {
                display_name: updatedUserInfo.display_name,
                balance: updatedUserInfo.balance,
                case_id: updatedUserInfo.case_id
            });
            
            return true;
            
        } catch (error) {
            console.error('❌ Erreur updateUserFromWebSocket:', error);
            return false;
        }
    },
};

// ==================== FONCTIONS GLOBALES ====================

export async function getStoredCredentials(): Promise<PayloadCredentials | null> {
    try {
        const credentials = await authService.getStoredCredentials();

        if (credentials) {
            return {
                db: credentials.db,
                username: credentials.username,
                password: credentials.password
            };
        }

        return null;
    } catch (error) {
        console.error('❌ Erreur getStoredCredentials globale:', error);
        return null;
    }
}

// ==================== EXPORT GLOBAL getCurrentUser ====================

export async function getCurrentUser(): Promise<AuthUser | null> {
    return await authService.getCurrentUser();
}

// Auto-initialisation
authService.initializeAuth();
