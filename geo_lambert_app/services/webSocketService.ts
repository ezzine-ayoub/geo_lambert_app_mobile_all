// WebSocket Service - Geo Lambert Project Management
import { getCurrentWebSocketUrl } from "./config/configService";
import io, { Socket } from "socket.io-client";
import projectService from "@/services/projectService";
import { authService } from "@/services/authService";
import { AppState, AppStateStatus } from 'react-native';

// ==================== SERVICE WEBSOCKET ====================

class WebSocketService {
    private name_project = "geo_lambert";
    private socket: Socket | null = null;
    private authuser: string | null = null;
    private pendingSubscriptions: (() => void)[] = []; // Private subscriptions waiting for auth
    private pendingPublicSubscriptions: (() => void)[] = []; // Public subscriptions waiting for socket connection
    private appState: AppStateStatus = 'active';
    
    async connect(): Promise<void> {
        if (this.socket && this.socket.connected) return;
        
        // Initialiser la gestion de l'état de l'app si pas déjà fait
        this.setupAppStateHandling();
        
        // Utiliser l'URL WebSocket configurée
        const wsUrl = getCurrentWebSocketUrl();
        
        console.log('🔗 Connexion WebSocket Geo Lambert à:', wsUrl);
        
        this.socket = io(wsUrl, {
            // Options pour maintenir la connexion
            forceNew: true,
            transports: ['websocket', 'polling'],
            timeout: 60000,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 10000,
        });

        this.socket.on("connect", async () => {
            console.log("🔗 Début de la connexion WebSocket...");

            // 1. EXÉCUTER IMMÉDIATEMENT LES SOUSCRIPTIONS PUBLIQUES
            console.log("📡 Exécution des souscriptions publiques (sans auth):", this.pendingPublicSubscriptions.length);
            this.pendingPublicSubscriptions.forEach((subscription, index) => {
                console.log("🌐 Exécution souscription publique #" + (index + 1));
                subscription();
            });
            this.pendingPublicSubscriptions = [];
            console.log("✅ Toutes les souscriptions publiques ont été exécutées");

            // 2. ESSAYER D'AUTHENTIFIER ET EXÉCUTER LES SOUSCRIPTIONS PRIVÉES
            try {
                let user = await authService.getCurrentUser();
                console.log("📤 Récupération utilisateur:", user);

                // Vérifier si c'est déjà un objet ou une chaîne
                if (typeof user === 'string') {
                    console.log("🔄 Parsing JSON nécessaire...");
                    user = JSON.parse(user);
                } else {
                    console.log("✅ Objet déjà parsé, pas de JSON.parse nécessaire");
                }

                // @ts-ignore
                this.authuser = user.id

                // Exécuter les souscriptions privées en attente
                console.log("🔒 Souscriptions privées en attente:", this.pendingSubscriptions.length);
                this.pendingSubscriptions.forEach((subscription, index) => {
                    console.log("🎯 Exécution souscription privée #" + (index + 1));
                    subscription();
                });
                this.pendingSubscriptions = [];
                console.log("✅ Toutes les souscriptions privées ont été exécutées");
                
            } catch (error) {
                console.error('❌ Erreur lors de l\'authentification:', error);
                console.log('⚠️ Seules les souscriptions publiques sont actives');
            }

        });

        this.socket.on("disconnect", async (reason) => {
            console.log("🔌 WebSocket déconnecté:", reason);
        });

        this.socket.on(`connect_error_${this.name_project}`, (err) => {
            console.error("❌ Erreur connexion WS:", err.message);
        });
    }
    disconnect(): void {
        this.socket?.disconnect();
        this.socket = null;
        this.authuser = null;

        // Nettoyer TOUTES les souscriptions en attente
        this.pendingSubscriptions = []; // Private subscriptions
        this.pendingPublicSubscriptions = []; // Public subscriptions
        console.log('✅ WebSocket déconnecté et nettoyé (souscriptions privées et publiques)');
    }
    private setupAppStateHandling(): void {
        if (this.appState !== 'active') return; // Déjà configuré
        
        console.log('📱 Configuration de la gestion d\'état de l\'app...');
        
        AppState.addEventListener('change', this.handleAppStateChange);
        this.appState = AppState.currentState;
        
        console.log('✅ Gestion d\'état de l\'app activée, état actuel:', this.appState);
    }
    private handleAppStateChange = (nextAppState: AppStateStatus) => {

        this.appState = nextAppState;
    };
    subscribe(event: string, callback: (msg: any) => void): void {
        this.socket?.on(event, callback);
    }
    /**
     * Souscription aux mises à jour de tâches
     */
    onTaskUpdate(callback: (task: any) => void): void {
        console.log("🚀 Méthode onTaskUpdate() appelée");
        console.log("🔍 État actuel authuser:", this.authuser);
        console.log("🔍 État socket connecté:", this.socket?.connected);
        
        const subscribeToTasks = () => {
            console.log("🎯 Début subscribeToTasks()...");

            if (!this.authuser) {
                console.error('❌ Impossible de créer le canal privé tâches: utilisateur non authentifié');
                console.log('📊 État debug - authuser:', this.authuser);
                return;
            }

            const privateTaskChannel = `${this.name_project}_tasks_user_id_${this.authuser}`;
            console.log('🔒 CRÉATION DU CANAL PRIVÉ TÂCHES:', privateTaskChannel);
            console.log('✨ Canal créé avec succès pour l\'utilisateur ID:', this.authuser);

            this.subscribe(privateTaskChannel, async (data: any) => {
                try {
                    console.log('🎉 MESSAGE TÂCHE REÇU SUR LE CANAL PRIVÉ:', privateTaskChannel);
                    console.log('📋 Données tâche reçues du socket:', JSON.stringify(data, null, 2));

                    // Vérifier si les données sont déjà parsées
                    let parsedTask;
                    if (typeof data === 'string') {
                        console.log('🔄 Parsing JSON nécessaire...');
                        parsedTask = JSON.parse(data);
                    } else {
                        console.log('✅ Données déjà parsées');
                        parsedTask = data;
                    }

                    console.log('🔄 Tâche parsée:', parsedTask);

                    // Traiter selon le type d'événement
                    const eventType = parsedTask.event_type || 'updated';
                    console.log('📝 Type d\'événement tâche:', eventType);

                    let success = false;

                    switch (eventType) {
                        case 'created':
                        case 'updated':
                        case 'sync':
                        case 'started':
                        case 'stopped':
                        case 'state_changed':
                            success = await projectService.insertOrUpdateTask(parsedTask);
                            break;

                        case 'deleted':
                            success = await projectService.deleteTask(parsedTask.id);
                            break;

                        default:
                            console.log('⚠️ Type d\'événement tâche non géré:', eventType);
                            success = true;
                    }

                    if (success) {
                        console.log('✅ Tâche traitée avec succès depuis socket:', parsedTask.id || parsedTask.name || 'ID inconnu');

                        console.log('📤 Envoi callback tâche à l\'UI...');
                        callback(parsedTask);
                        console.log('✨ Callback tâche UI exécuté avec succès');
                    } else {
                        console.error('❌ Échec traitement tâche depuis socket:', parsedTask.id || 'ID inconnu');
                    }
                } catch (error) {
                    console.error('❌ Erreur traitement tâche socket:', error);
                    console.error('📊 Stack trace:', error);
                }
            });

            console.log('🎯 Souscription au canal privé tâches terminée avec succès');
        };

        if (this.authuser) {
            console.log('⚡ Utilisateur déjà authentifié, souscription tâches immédiate');
            subscribeToTasks();
        } else {
            console.log('⏳ Utilisateur pas encore authentifié, ajout souscription tâches à la queue');
            this.pendingSubscriptions.push(subscribeToTasks);
            console.log('📝 Souscription aux tâches en attente de l\'authentification');
            console.log('📊 Nombre de souscriptions en attente:', this.pendingSubscriptions.length);
        }
    }
    onExpenseUpdate(callback: (expense: any) => void): void {
        console.log("🚀 Méthode onExpenseUpdate() appelée");
        console.log("🔍 État actuel authuser:", this.authuser);
        console.log("🔍 État socket connecté:", this.socket?.connected);
        
        const subscribeToExpenses = () => {
            console.log("🎯 Début subscribeToExpenses()...");

            if (!this.authuser) {
                console.error('❌ Impossible de créer le canal privé dépenses: utilisateur non authentifié');
                console.log('📊 État debug - authuser:', this.authuser);
                return;
            }

            const privateExpenseChannel = `${this.name_project}_expenses_user_id_${this.authuser}`;
            console.log('🔒 CRÉATION DU CANAL PRIVÉ DÉPENSES:', privateExpenseChannel);
            console.log('✨ Canal créé avec succès pour l\'utilisateur ID:', this.authuser);

            this.subscribe(privateExpenseChannel, async (data: any) => {
                try {
                    console.log('🎉 MESSAGE DÉPENSE REÇU SUR LE CANAL PRIVÉ:', privateExpenseChannel);
                    console.log('💰 Données dépense reçues du socket:', JSON.stringify(data, null, 2));

                    // Vérifier si les données sont déjà parsées
                    let parsedExpense;
                    if (typeof data === 'string') {
                        console.log('🔄 Parsing JSON nécessaire...');
                        parsedExpense = JSON.parse(data);
                    } else {
                        console.log('✅ Données déjà parsées');
                        parsedExpense = data;
                    }

                    console.log('🔄 Dépense parsée:', parsedExpense);

                    // Traiter selon le type d'événement
                    const eventType = parsedExpense.event_type || 'updated';
                    console.log('📝 Type d\'événement dépense:', eventType);

                    let success = false;

                    switch (eventType) {
                        case 'created':
                        case 'updated':
                        case 'sync':
                            success = await projectService.insertOrUpdateExpense(parsedExpense);
                            break;

                        case 'deleted':
                            success = await projectService.deleteExpense(parsedExpense.id);
                            break;

                        default:
                            console.log('⚠️ Type d\'événement dépense non géré:', eventType);
                            success = true;
                    }

                    if (success) {
                        console.log('✅ Dépense traitée avec succès depuis socket:', parsedExpense.id || 'ID inconnu');

                        console.log('📤 Envoi callback dépense à l\'UI...');
                        callback(parsedExpense);
                        console.log('✨ Callback dépense UI exécuté avec succès');
                    } else {
                        console.error('❌ Échec traitement dépense depuis socket:', parsedExpense.id || 'ID inconnu');
                    }
                } catch (error) {
                    console.error('❌ Erreur traitement dépense socket:', error);
                    console.error('📊 Stack trace:', error);
                }
            });

            console.log('🎯 Souscription au canal privé dépenses terminée avec succès');
        };

        if (this.authuser) {
            console.log('⚡ Utilisateur déjà authentifié, souscription dépenses immédiate');
            subscribeToExpenses();
        } else {
            console.log('⏳ Utilisateur pas encore authentifié, ajout souscription dépenses à la queue');
            this.pendingSubscriptions.push(subscribeToExpenses);
            console.log('📝 Souscription aux dépenses en attente de l\'authentification');
            console.log('📊 Nombre de souscriptions en attente:', this.pendingSubscriptions.length);
        }
    }
    onExpenseDelete(callback: (expense: any) => void): void {
        console.log("🚀 Méthode onExpenseDelete() appelée");
        console.log("🔍 État actuel authuser:", this.authuser);
        console.log("🔍 État socket connecté:", this.socket?.connected);

        const subscribeToExpenseDeletes = () => {
            console.log("🎯 Début subscribeToExpenseDeletes()...");

            if (!this.authuser) {
                console.error('❌ Impossible de créer le canal privé suppression dépenses: utilisateur non authentifié');
                console.log('📊 État debug - authuser:', this.authuser);
                return;
            }

            const privateExpenseDeleteChannel = `${this.name_project}_expenses_delete_user_id_${this.authuser}`;
            console.log('🔒 CRÉATION DU CANAL PRIVÉ SUPPRESSION DÉPENSES:', privateExpenseDeleteChannel);
            console.log('✨ Canal créé avec succès pour l\'utilisateur ID:', this.authuser);

            this.subscribe(privateExpenseDeleteChannel, async (data: any) => {
                try {
                    console.log('🎉 MESSAGE SUPPRESSION DÉPENSE REÇU:', privateExpenseDeleteChannel);
                    console.log('🗑️ Données suppression dépense:', JSON.stringify(data, null, 2));

                    const parsedExpense = typeof data === 'string' ? JSON.parse(data) : data;
                    console.log('🔄 Dépense à supprimer parsée:', parsedExpense);

                    // Supprimer la dépense
                    const success = await projectService.deleteExpense(parsedExpense.id);

                    if (success) {
                        console.log('✅ Dépense supprimée avec succès:', parsedExpense.id);

                        callback(parsedExpense);
                    } else {
                        console.error('❌ Échec suppression dépense:', parsedExpense.id || 'inconnue');
                    }

                } catch (error) {
                    console.error('❌ Erreur suppression dépense socket:', error);
                }
            });

            console.log('🎯 Souscription au canal privé suppression dépenses terminée');
        };

        if (this.authuser) {
            console.log('⚡ Utilisateur déjà authentifié, souscription suppression dépenses immédiate');
            subscribeToExpenseDeletes();
        } else {
            console.log('⏳ Utilisateur pas encore authentifié, ajout souscription suppression dépenses à la queue');
            this.pendingSubscriptions.push(subscribeToExpenseDeletes);
            console.log('📝 Souscription aux suppressions dépenses en attente de l\'authentification');
            console.log('📊 Nombre de souscriptions en attente:', this.pendingSubscriptions.length);
        }
    }
    onGeoLambertAppMessage(callback: (message: any) => void): void {
        console.log("🚀 Méthode onGeoLambertAppMessage() appelée (CANAL PUBLIC)");
        console.log("🔍 État socket connecté:", this.socket?.connected);
        
        const subscribeToGeoLambertAppMessages = () => {
            const publicGeoLambertAppMessageChannel = `message_app_${this.name_project}`;
            console.log('📡 CRÉATION DU CANAL PUBLIC MESSAGES APP GEO LAMBERT (PAS D\'AUTH REQUISE):', publicGeoLambertAppMessageChannel);
            
            this.subscribe(publicGeoLambertAppMessageChannel, async (data: any) => {
                try {
                    console.log('🎉 MESSAGE REÇU SUR LE CANAL PUBLIC GEO LAMBERT APP:', publicGeoLambertAppMessageChannel);
                    console.log('📢 Données message Geo Lambert app reçues du socket:', JSON.stringify(data, null, 2));
                    
                    // Vérifier si les données sont déjà parsées ou sous forme de chaîne
                    let parsedMessage;
                    if (typeof data === 'string') {
                        console.log('🔄 Parsing JSON nécessaire...');
                        parsedMessage = JSON.parse(data);
                    } else {
                        console.log('✅ Données déjà parsées');
                        parsedMessage = data;
                    }

                    console.log('🔄 Message Geo Lambert app parsé:', parsedMessage);

                    console.log('📤 Envoi callback message Geo Lambert app à l\'UI...');
                    callback(parsedMessage);
                    console.log('✨ Callback message Geo Lambert app UI exécuté avec succès');

                } catch (error) {
                    console.error('❌ Erreur traitement message Geo Lambert app socket:', error);
                    console.error('📊 Stack trace:', error);
                }
            });

            console.log('🎯 Souscription au canal public messages Geo Lambert app terminée avec succès');
        };

        // IMPORTANT: Ce canal est PUBLIC - pas besoin d'attendre l'authentification
        if (this.socket && this.socket.connected) {
            console.log('⚡ Socket connecté, souscription messages Geo Lambert app immédiate (CANAL PUBLIC)');
            subscribeToGeoLambertAppMessages();
        } else {
            console.log('⏳ Socket pas encore connecté, ajout souscription publique à la queue');
            this.pendingPublicSubscriptions.push(subscribeToGeoLambertAppMessages);
            console.log('📝 Souscription publique aux messages Geo Lambert app en attente de la connexion socket');
            console.log('📊 Nombre de souscriptions publiques en attente:', this.pendingPublicSubscriptions.length);
        }
    }
    onConnectionStatusChange(callback: (connected: boolean) => void): void {
        this.socket?.on("connect", async () => {
            callback(true);
            console.log("Connected!");
        });
        this.socket?.on("disconnect", async () => {
            callback(false);
        });
    }
    // ==================== MÉTHODES UTILITAIRES ====================

    isConnected(): boolean {
        return this.socket?.connected || false;
    }
    // Unsubscribe from all events (useful for cleanup)
    unsubscribeAll(): void {
        console.log('🧹 Début du nettoyage des listeners...');

        if (!this.socket) {
            console.log('⚠️ Pas de socket à nettoyer');
            return;
        }

        // Unsubscribe from private channels if user is authenticated
        if (this.authuser) {
            // Canaux Geo Lambert Project Management
            const privateProjectChannel = `${this.name_project}_projects_user_id_${this.authuser}`;
            const privateTaskChannel = `${this.name_project}_tasks_user_id_${this.authuser}`;
            const privateExpenseChannel = `${this.name_project}_expenses_user_id_${this.authuser}`;
            const privateExpenseDeleteChannel = `${this.name_project}_expenses_delete_user_id_${this.authuser}`;

            // Legacy channels
            const privateCommandChannel = `command_user_id_${this.authuser}`;
            const privateOrderDeleteChannel = `order_delete_user_id_${this.authuser}`;
            const privateProductChannel = `products_user_id_${this.authuser}`;
            const privateProductDeleteChannel = `products_delete_user_id_${this.authuser}`;
            const privateEditProfileChannel = `edit_profil_${this.authuser}`;
            const privateUserMessageChannel = `user_message_${this.authuser}_${this.name_project}`;

            // Nettoyage canaux Geo Lambert
            console.log('🔒 Nettoyage du canal privé projets:', privateProjectChannel);
            this.socket.off(privateProjectChannel);

            console.log('🔒 Nettoyage du canal privé tâches:', privateTaskChannel);
            this.socket.off(privateTaskChannel);

            console.log('🔒 Nettoyage du canal privé dépenses:', privateExpenseChannel);
            this.socket.off(privateExpenseChannel);

            console.log('🔒 Nettoyage du canal privé suppression dépenses:', privateExpenseDeleteChannel);
            this.socket.off(privateExpenseDeleteChannel);

            // Nettoyage canaux legacy
            console.log('🔒 Nettoyage du canal privé commandes (legacy):', privateCommandChannel);
            this.socket.off(privateCommandChannel);

            console.log('🔒 Nettoyage du canal privé suppression commandes (legacy):', privateOrderDeleteChannel);
            this.socket.off(privateOrderDeleteChannel);

            console.log('🔒 Nettoyage du canal privé produits (legacy):', privateProductChannel);
            this.socket.off(privateProductChannel);

            console.log('🔒 Nettoyage du canal privé suppression produits (legacy):', privateProductDeleteChannel);
            this.socket.off(privateProductDeleteChannel);

            console.log('🔒 Nettoyage du canal privé édition profil:', privateEditProfileChannel);
            this.socket.off(privateEditProfileChannel);

            console.log('🔒 Nettoyage du canal privé messages utilisateur:', privateUserMessageChannel);
            this.socket.off(privateUserMessageChannel);
        } else {
            console.log('⚠️ Pas d\'utilisateur authentifié, pas de canaux privés à nettoyer');
        }

        // Nettoyer les canaux publics
        console.log(`📡 Nettoyage du canal public messages Geo Lambert app: message_app_${this.name_project}`);
        this.socket.off(`message_app_${this.name_project}`);

        console.log(`📡 Nettoyage du canal public messages app (legacy): message_app_${this.name_project}`);
        this.socket.off(`message_app_${this.name_project}`);

        console.log('📡 Nettoyage du canal public produits: products');
        this.socket.off('products');

        console.log(`📡 Nettoyage du canal public messages: message_${this.name_project}`);
        this.socket.off(`message_${this.name_project}`);

        // Nettoyer les listeners généraux
        this.socket.off('connect');
        this.socket.off('disconnect');

        console.log('🗑️ Tous les listeners WebSocket supprimés avec succès');
    }
}

export const webSocketService = new WebSocketService();
export default webSocketService;
