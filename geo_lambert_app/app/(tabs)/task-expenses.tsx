import React, {useEffect, useState, useRef} from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    RefreshControl,
    StatusBar,
    Alert,
    Modal,
    TextInput,
    Pressable,
    KeyboardAvoidingView,
    Platform,
    Animated,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useLocalSearchParams, router, Stack} from 'expo-router';
import projectService, {
    type ExpenseData,
    subscribeToProjectUpdates,
    subscribeToProjectsCleared,
    subscribeToProjectDeleted,
    subscribeToTaskDeleted
} from '@/services/projectService';
import expenseCategoryService, {type ExpenseCategory} from '@/services/expenseCategoryService';
import {authService} from '@/services/authService';

/**
 * ✅ LOGIC DES BOUTONS TIMER BASÉ SUR timer_start ET timer_pause:
 *
 * 1. Si timer_start est false/null -> ÉTAT: STOPPED
 *    - Afficher: [START]
 *
 * 2. Si timer_start existe ET timer_pause est false/null -> ÉTAT: RUNNING
 *    - Afficher: [PAUSE] [STOP]
 *
 * 3. Si timer_start existe ET timer_pause existe -> ÉTAT: PAUSED
 *    - Afficher: [RESUME] [STOP]
 */
export default function TaskExpensesScreen() {
    const params = useLocalSearchParams();
    const [task, setTask] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [modalVisible, setModalVisible] = useState(false);
    const [newExpenseAmount, setNewExpenseAmount] = useState('');
    const [newExpenseType, setNewExpenseType] = useState('sous_traitance');
    const [newExpenseDescription, setNewExpenseDescription] = useState('');
    const [showTypeDropdown, setShowTypeDropdown] = useState(false);
    const [timerState, setTimerState] = useState<'stopped' | 'running' | 'paused'>('stopped');
    const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
    const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);

    // État pour le modal de détails de dépense
    const [expenseDetailsVisible, setExpenseDetailsVisible] = useState(false);
    const [selectedExpense, setSelectedExpense] = useState<any>(null);

    // Expense categories states
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | null>(null);
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [loadingCategories, setLoadingCategories] = useState(true);

    // Animation pour l'icône de refresh
    const rotateAnim = useRef(new Animated.Value(0)).current;

    // ✅ Charger les catégories de dépenses au démarrage
    useEffect(() => {
        const loadCategories = async () => {
            try {
                console.log('📋 Chargement des catégories de dépenses...');
                setLoadingCategories(true);
                const response = await expenseCategoryService.getExpenseCategories();

                if (response.success && response.result) {
                    setExpenseCategories(response.result);
                    console.log(`✅ ${response.result.length} catégories chargées`);
                } else {
                    console.warn('⚠️ Erreur chargement catégories:', response.message);
                }
            } catch (error) {
                console.error('❌ Erreur chargement catégories:', error);
            } finally {
                setLoadingCategories(false);
            }
        };

        loadCategories();
    }, []);

    useEffect(() => {
        if (refreshing) {
            // Démarrer l'animation de rotation
            Animated.loop(
                Animated.timing(rotateAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                })
            ).start();
        } else {
            // Réinitialiser l'animation
            rotateAnim.setValue(0);
        }
    }, [refreshing]);

    const spin = rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    // ✅ Function pour déterminer l'état du timer basé sur timer_start et timer_pause
    const determineTimerState = (timer_start?: string | false, timer_pause?: string | false): 'stopped' | 'running' | 'paused' => {
        // Si pas de timer_start ou timer_start est false -> stopped
        if (!timer_start || timer_start === false) {
            return 'stopped';
        }

        // Si timer_start existe et timer_pause existe -> paused
        if (timer_start && timer_pause && timer_pause !== false) {
            return 'paused';
        }

        // Si timer_start existe et pas de timer_pause -> running
        if (timer_start && (!timer_pause || timer_pause === false)) {
            return 'running';
        }

        return 'stopped';
    };

    // ✅ Function pour formater le temps en HH:MM:SS
    const formatElapsedTime = (totalSeconds: number): string => {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        // @ts-ignore
        return `${(hours.toString().padStart(2, '0') >= 0) ? '00' : hours.toString().padStart(2, '0') - 1}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    // ✅ Function pour calculer le temps écoulé (avec correction timezone)
    const calculateElapsedTime = (timer_start?: string | false, timer_pause?: string | false): number => {
        if (!timer_start || timer_start === false) {
            return 0;
        }

        // ✅ Utiliser getTime() pour éviter les problèmes de timezone
        const startTime = new Date(timer_start).getTime();
        const now = Date.now(); // Plus précis que new Date().getTime()

        // Si en pause, utiliser timer_pause comme temps de fin
        if (timer_pause && timer_pause !== false) {
            const pauseTime = new Date(timer_pause).getTime();
            const elapsed = Math.floor((pauseTime - startTime) / 1000);
            // ✅ S'assurer que le temps n'est jamais négatif
            return Math.max(0, elapsed);
        }

        // Si en cours, utiliser le temps actuel
        const elapsed = Math.floor((now - startTime) / 1000);
        // ✅ S'assurer que le temps n'est jamais négatif
        return Math.max(0, elapsed);
    };

    // ✅ Function pour mettre à jour le temps affiché (avec debug)
    const updateElapsedTime = () => {
        if (task && task.timer_start) {
            const elapsed = calculateElapsedTime(task.timer_start, task.timer_pause);
            setElapsedTime(formatElapsedTime(elapsed));
        }
    };

    // Load task details from API
    const loadTaskDetails = async (taskId: number, projectId?: number) => {
        try {
            console.log('📋 Chargement des détails de la tâche:', taskId);
            const response = await projectService.getProjects();
            if (response.success && response.result) {
                // Find the project containing this task
                let updatedTask = null;
                for (const proj of response.result) {
                    if (proj.task_ids) {
                        const foundTask = proj.task_ids.find(t => t.id === taskId);
                        if (foundTask) {
                            updatedTask = foundTask;
                            break;
                        }
                    }
                }

                if (updatedTask) {
                    // @ts-ignore
                    setTask(updatedTask);
                    // Update timer state based on new data
                    const newTimerState = determineTimerState(updatedTask.timer_start, updatedTask.timer_pause);
                    setTimerState(newTimerState);

                    // Update elapsed time
                    const newElapsed = calculateElapsedTime(updatedTask.timer_start, updatedTask.timer_pause);
                    setElapsedTime(formatElapsedTime(newElapsed));

                    console.log('✅ Tâche mise à jour:', updatedTask.name);
                } else {
                    console.warn('⚠️ Tâche non trouvée dans la réponse');
                }
            }
        } catch (error) {
            console.error('❌ Erreur chargement tâche:', error);
        }
    };

    useEffect(() => {
        if (params.task) {
            try {
                const taskData = JSON.parse(params.task as string);
                setTask(taskData);

                // ✅ Déterminer l'état du timer basé sur les données de la tâche
                const initialTimerState = determineTimerState(taskData.timer_start, taskData.timer_pause);
                setTimerState(initialTimerState);

                // ✅ Calculer le temps initial
                const initialElapsed = calculateElapsedTime(taskData.timer_start, taskData.timer_pause);
                setElapsedTime(formatElapsedTime(initialElapsed));

                console.log('🔍 État initial du timer:', {
                    timer_start: taskData.timer_start,
                    timer_pause: taskData.timer_pause,
                    determined_state: initialTimerState,
                    elapsed_time: formatElapsedTime(initialElapsed)
                });

                setLoading(false);

                // Auto-refresh on mount
                if (taskData.id) {
                    loadTaskDetails(taskData.id);
                }
            } catch (error) {
                console.error('Erreur parsing task data:', error);
                Alert.alert('Erreur', 'Impossible de charger les dépenses de la tâche');
                router.back();
            }
        }
    }, [params.task]);

    // 🔄 S'abonner aux mises à jour WebSocket du projet parent
    useEffect(() => {
        if (!task) return;

        console.log('🔔 Abonnement aux mises à jour pour la tâche:', task.id);

        const unsubscribe = subscribeToProjectUpdates((updatedProject) => {
            // Chercher notre tâche dans le projet mis à jour
            if (updatedProject.task_ids && Array.isArray(updatedProject.task_ids)) {
                const updatedTask = updatedProject.task_ids.find(t => t.id === task.id);

                if (updatedTask) {
                    console.log('🔄 Tâche mise à jour via WebSocket:', updatedTask.id);
                    setTask(updatedTask);

                    // Mettre à jour l'état du timer
                    const newTimerState = determineTimerState(updatedTask.timer_start, updatedTask.timer_pause);
                    setTimerState(newTimerState);

                    // Mettre à jour le temps écoulé
                    const newElapsed = calculateElapsedTime(updatedTask.timer_start, updatedTask.timer_pause);
                    setElapsedTime(formatElapsedTime(newElapsed));
                }
            }
        });

        return () => {
            console.log('🧹 Désabonnement des mises à jour de la tâche:', task.id);
            unsubscribe();
        };
    }, [task?.id]);

    // 🗑️ S'abonner aux suppressions de tâches WebSocket
    useEffect(() => {
        if (!task) return;

        console.log('🔔 Abonnement aux suppressions de tâches (task-expenses)...');

        const unsubscribe = subscribeToTaskDeleted(({ projectId, taskId }) => {
            // Vérifier si c'est notre tâche qui a été supprimée
            if (taskId === task.id) {
                console.log('🗑️ Notre tâche supprimée via WebSocket:', taskId);
                
                // ✅ Mettre à jour le state pour indiquer que la tâche est supprimée
                setTask(prev => prev ? { ...prev, expense_ids: [] } : null);
            }
        });

        return () => {
            console.log('🧹 Désabonnement des suppressions de tâches (task-expenses)');
            unsubscribe();
        };
    }, [task?.id]);

    // 🗑️ S'abonner aux suppressions de projets WebSocket
    useEffect(() => {
        if (!task) return;

        console.log('🔔 Abonnement aux suppressions de projets (task-expenses)...');

        const unsubscribe = subscribeToProjectDeleted(async (deletedProjectId) => {
            console.log('🗑️ Projet supprimé via WebSocket:', deletedProjectId);

            // Vérifier si notre tâche existe toujours
            try {
                const response = await projectService.getProjects();
                let taskStillExists = false;

                if (response.success && response.result) {
                    for (const proj of response.result) {
                        if (proj.task_ids && proj.task_ids.some(t => t.id === task.id)) {
                            taskStillExists = true;
                            break;
                        }
                    }
                }

                // Si la tâche n'existe plus (projet supprimé), mettre à jour le state
                if (!taskStillExists) {
                    console.log('⚠️ Tâche n\'existe plus après suppression du projet');
                    
                    // ✅ Mettre à jour le state pour indiquer que la tâche est supprimée
                    setTask(prev => prev ? { ...prev, expense_ids: [] } : null);
                }
            } catch (error) {
                console.error('❌ Erreur vérification existence tâche:', error);
            }
        });

        return () => {
            console.log('🧹 Désabonnement des suppressions de projets (task-expenses)');
            unsubscribe();
        };
    }, [task?.id]);

    // 🗑️ S'abonner au vidage du cache
    useEffect(() => {
        console.log('🔔 Abonnement au vidage du cache (task-expenses)...');

        const unsubscribe = subscribeToProjectsCleared(() => {
            console.log('🗑️ Cache vidé - Données en cache supprimées');
            // ✅ Ne pas rediriger, juste logger
            // L'utilisateur peut rafraîchir manuellement pour recharger les données
        });

        return () => {
            console.log('🧹 Désabonnement du vidage du cache (task-expenses)');
            unsubscribe();
        };
    }, []);

    // ✅ UseEffect pour gérer l'interval du timer
    useEffect(() => {
        // Nettoyer l'interval existant
        if (intervalId) {
            clearInterval(intervalId);
            setIntervalId(null);
        }

        // Créer un nouvel interval seulement si le timer est en cours d'exécution (RUNNING)
        if (timerState === 'running' && task && task.timer_start) {
            const newIntervalId = setInterval(() => {
                updateElapsedTime();
            }, 1000);
            setIntervalId(newIntervalId);
        } else if (timerState === 'stopped') {
            setElapsedTime('00:00:00');
        } else if (timerState === 'paused' && task) {
            // ✅ Pour PAUSED: calculer une seule fois et arrêter le compteur
            const pausedElapsed = calculateElapsedTime(task.timer_start, task.timer_pause);
            setElapsedTime(formatElapsedTime(pausedElapsed));
        }

        // Cleanup function
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [timerState, task]);


    const onRefresh = React.useCallback(async () => {
        if (!task) return;

        setRefreshing(true);
        const startTime = Date.now();

        try {
            await projectService.forceRefreshProjects()
            await loadTaskDetails(task.id);
        } catch (error) {
            console.error('❌ Erreur refresh:', error);
        } finally {
            // Assurer un délai minimum de 1 seconde
            const elapsedTime = Date.now() - startTime;
            const remainingTime = Math.max(0, 1000 - elapsedTime);

            setTimeout(() => {
                setRefreshing(false);
            }, remainingTime);
        }
    }, [task]);


    const formatDate = (dateString) => {
        if (!dateString) return 'Date non définie';
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    const extractAmountFromDisplayName = (displayName) => {
        if (!displayName) return '0.00';
        const match = displayName.match(/(\d+\.\d{2})/);
        return match ? match[1] : '0.00';
    };

    const handleAddExpense = () => {
        setModalVisible(true);
        setNewExpenseAmount('');
        setNewExpenseType('');
        setNewExpenseDescription('');
        setSelectedCategory(null);
        setShowCategoryDropdown(false);
        setShowTypeDropdown(false);
    };

    const handleSaveExpense = async () => {
        if (!selectedCategory) {
            Alert.alert('Erreur', 'Veuillez sélectionner une catégorie');
            return;
        }

        if (!newExpenseType) {
            Alert.alert('Erreur', 'Veuillez sélectionner un type de dépense');
            return;
        }

        if (!newExpenseAmount || parseFloat(newExpenseAmount) <= 0) {
            Alert.alert('Erreur', 'Veuillez saisir un montant valide');
            return;
        }

        try {
            console.log('💰 Création d\'une nouvelle dépense...');
            console.log(newExpenseType)
            // ✅ Récupérer l'utilisateur connecté
            const currentUser = await authService.getCurrentUser();
            if (!currentUser || !currentUser.id) {
                Alert.alert('Erreur', 'Impossible de récupérer l\'utilisateur connecté');
                return;
            }

            const currentDate = new Date().toISOString().split('T')[0];

            console.log(newExpenseType)
            // Trouver le type sélectionné
            const selectedType = selectedCategory.expense_type_ids.find(t => t.id.toString() === newExpenseType);


            const expenseData: ExpenseData = {
                user_id: currentUser.id, // ✅ ID utilisateur connecté
                // @ts-ignore
                expense_category_id: selectedCategory.id, // ✅ ID de la catégorie sélectionnée
                expense_type_id: parseInt(newExpenseType), // ✅ ID du type (converti en nombre)
                amount: parseFloat(newExpenseAmount),
                description: newExpenseDescription.trim() || '',
                expense_date: currentDate
            };

            // @ts-ignore
            const response = await projectService.createExpense(task.id, expenseData);

            if (response.success) {
                // ✅ Rafraîchir les données de la tâche depuis l'API pour obtenir la dernière version
                setRefreshing(true);
                const startTime = Date.now();
                console.log(JSON.stringify(response, null, 2));
                // Assurer un délai minimum de 1 seconde
                const elapsedTime = Date.now() - startTime;
                const remainingTime = Math.max(0, 1000 - elapsedTime);

                setTimeout(() => {
                    setRefreshing(false);
                }, remainingTime);

                Alert.alert(
                    'Succès',
                    `Dépense ajoutée avec succès !\nType: ${selectedType?.name}\nMontant: ${newExpenseAmount} MAD`,
                    [{
                        text: 'OK',
                        onPress: () => {
                            setModalVisible(false);
                        }
                    }]
                );
                console.log('✅ Dépense créée avec succès, tâche rafraîchie');
            } else {
                Alert.alert(
                    'Erreur',
                    response.message || 'Impossible de créer la dépense'
                );
                console.error('❌ Erreur création dépense:', response.message);
            }

        } catch (error) {
            console.error('❌ Erreur lors de la création de la dépense:', error);
            Alert.alert(
                'Erreur',
                'Une erreur est survenue lors de la création de la dépense'
            );
        }
    };

    const handleCancelExpense = () => {
        setModalVisible(false);
        setNewExpenseAmount('');
        setNewExpenseType('');
        setNewExpenseDescription('');
        setSelectedCategory(null);
        setShowCategoryDropdown(false);
        setShowTypeDropdown(false);
    };

    const handleStartTimer = async () => {
        // @ts-ignore
        const previousTask = {...task};
        const previousTimerState = timerState;
        const previousElapsedTime = elapsedTime;

        try {
            // ✅ OPTIMISTIC UPDATE: Mettre à jour l'UI immédiatement
            const now = new Date().toISOString();
            const updatedTask = {
                ...task,
                timer_start: now,
                timer_pause: false
            };

            setTask(updatedTask);
            setTimerState('running');
            setElapsedTime('00:00:00');

            // Faire l'appel API en arrière-plan
            const response = await projectService.startTaskTimer(task.id);

            if (response.success) {
                console.log('✅ Timer démarré, refresh du cache...');
            } else {
                // ❌ ROLLBACK: Restaurer l'état précédent si échec
                setTask(previousTask);
                setTimerState(previousTimerState);
                setElapsedTime(previousElapsedTime);

                Alert.alert(
                    'Erreur',
                    response.message || 'Impossible de démarrer le timer'
                );
                console.error('❌ Erreur démarrage timer:', response.message);
            }

        } catch (error) {
            // ❌ ROLLBACK en cas d'erreur
            setTask(previousTask);
            setTimerState(previousTimerState);
            setElapsedTime(previousElapsedTime);

            console.error('❌ Erreur lors du démarrage du timer:', error);
            Alert.alert(
                'Erreur',
                'Une erreur est survenue lors du démarrage du timer'
            );
        }
    };

    const handleResumeTimer = async () => {
        // Sauvegarder l'état précédent pour le rollback
        const previousTask = {...task};
        const previousTimerState = timerState;
        const previousElapsedTime = elapsedTime;

        try {
            console.log('▶️ Reprise du timer pour la tâche:', task.id);

            // ✅ OPTIMISTIC UPDATE: Mettre à jour l'UI immédiatement
            const now = new Date().toISOString();
            const pausedDuration = task.timer_pause ?
                Math.floor((new Date(task.timer_pause).getTime() - new Date(task.timer_start).getTime()) / 1000) : 0;

            const updatedTask = {
                ...task,
                timer_start: new Date(Date.now() - (pausedDuration * 1000)).toISOString(),
                timer_pause: false
            };

            setTask(updatedTask);
            setTimerState('running');

            // Faire l'appel API en arrière-plan
            const response = await projectService.resumeTaskTimer(task.id);

            if (response.success) {
                console.log('✅ Timer repris, refresh du cache...');

            } else {
                // ❌ ROLLBACK
                setTask(previousTask);
                setTimerState(previousTimerState);
                setElapsedTime(previousElapsedTime);

                Alert.alert(
                    'Erreur',
                    response.message || 'Impossible de reprendre le timer'
                );
                console.error('❌ Erreur reprise timer:', response.message);
            }

        } catch (error) {
            // ❌ ROLLBACK
            setTask(previousTask);
            setTimerState(previousTimerState);
            setElapsedTime(previousElapsedTime);

            console.error('❌ Erreur lors de la reprise du timer:', error);
            Alert.alert(
                'Erreur',
                'Une erreur est survenue lors de la reprise du timer'
            );
        }
    };

    // ✅ Function supprimée - maintenant on utilise handleStartTimer et handleResumeTimer séparément

    const handlePauseTimer = async () => {
        // Sauvegarder l'état précédent pour le rollback
        const previousTask = {...task};
        const previousTimerState = timerState;
        const previousElapsedTime = elapsedTime;

        try {
            console.log('⏸️ Pause du timer pour la tâche:', task.id);

            // ✅ OPTIMISTIC UPDATE: Mettre à jour l'UI immédiatement
            const now = new Date().toISOString();
            const updatedTask = {
                ...task,
                timer_pause: now
            };

            setTask(updatedTask);
            setTimerState('paused');

            // Calculer et figer le temps écoulé
            const elapsed = calculateElapsedTime(task.timer_start, now);
            setElapsedTime(formatElapsedTime(elapsed));

            // Faire l'appel API en arrière-plan
            const response = await projectService.pauseTaskTimer(task.id);

            if (response.success) {
                console.log('✅ Timer en pause, refresh du cache...');

            } else {
                // ❌ ROLLBACK
                setTask(previousTask);
                setTimerState(previousTimerState);
                setElapsedTime(previousElapsedTime);

                Alert.alert(
                    'Erreur',
                    response.message || 'Impossible de mettre le timer en pause'
                );
                console.error('❌ Erreur pause timer:', response.message);
            }

        } catch (error) {
            // ❌ ROLLBACK
            setTask(previousTask);
            setTimerState(previousTimerState);
            setElapsedTime(previousElapsedTime);

            console.error('❌ Erreur lors de la pause du timer:', error);
            Alert.alert(
                'Erreur',
                'Une erreur est survenue lors de la pause du timer'
            );
        }
    };

    const handleStopTimer = async () => {
        Alert.alert(
            'Arrêter le timer',
            `Voulez-vous vraiment arrêter le timer pour la tâche "${task.name}" ?`,
            [
                {
                    text: 'Annuler',
                    style: 'cancel'
                },
                {
                    text: 'Arrêter',
                    style: 'destructive',
                    onPress: async () => {
                        // Sauvegarder l'état précédent pour le rollback
                        // @ts-ignore
                        const previousTask = {...task};
                        const previousTimerState = timerState;
                        const previousElapsedTime = elapsedTime;

                        try {
                            console.log('⏹️ Arrêt du timer pour la tâche:', task.id);

                            // ✅ OPTIMISTIC UPDATE: Mettre à jour l'UI immédiatement
                            const updatedTask = {
                                ...task,
                                timer_start: false,
                                timer_pause: false
                            };

                            setTask(updatedTask);
                            setTimerState('stopped');
                            setElapsedTime('00:00:00');

                            // Essayer d'abord la méthode principale
                            let response = await projectService.stopTaskTimer(task.id);

                            // Si la première méthode échoue, essayer l'alternative
                            if (!response.success) {
                                console.log('⚠️ Méthode principale échouée, tentative alternative...');
                                response = await projectService.stopTaskTimerAlternative(task.id);
                            }

                            // Si toutes les méthodes standards échouent, essayer toutes les méthodes possibles
                            if (!response.success) {
                                console.log('⚠️ Toutes les méthodes standards ont échoué, tentative de toutes les méthodes...');
                                response = await projectService.stopTaskTimerMultipleMethods(task.id);
                            }

                            if (response.success) {
                                console.log('✅ Timer arrêté, refresh du cache...');

                            } else {
                                // ❌ ROLLBACK
                                setTask(previousTask);
                                setTimerState(previousTimerState);
                                setElapsedTime(previousElapsedTime);

                                Alert.alert(
                                    'Erreur',
                                    `Impossible d'arrêter le timer:\n${response.message}`
                                );
                                console.error('❌ Erreur arrêt timer:', response.message);
                            }

                        } catch (error) {
                            // ❌ ROLLBACK
                            setTask(previousTask);
                            setTimerState(previousTimerState);
                            setElapsedTime(previousElapsedTime);

                            console.error('❌ Erreur lors de l\'arrêt du timer:', error);
                            Alert.alert(
                                'Erreur',
                                'Une erreur est survenue lors de l\'arrêt du timer'
                            );
                        }
                    }
                }
            ]
        );
    };


    const handleExpensePress = (expense: any) => {
        console.log('💰 Dépense sélectionnée:', expense);
        setSelectedExpense(expense);
        setExpenseDetailsVisible(true);
    };

    const ExpenseCard = ({expense}) => {
        // ✅ Récupérer directement le nom du type depuis expense_type_id
        const expenseTypeName = expense.expense_type_id && expense.expense_type_id.length > 0
            ? expense.expense_type_id[0].name
            : 'Type non défini';

        // ✅ Récupérer directement le nom de la catégorie depuis expense_category_id
        const expenseCategoryName = expense.expense_category_id && expense.expense_category_id.length > 0
            ? expense.expense_category_id[0].name
            : 'Non catégorisé';

        // Icône moderne avec gradient colors
        const getCategoryColor = () => {
            // 🛡️ Protection contre undefined
            if (!expenseCategoryName) return ['#6b7280', '#4b5563'];

            const categoryLower = expenseCategoryName.toLowerCase();
            if (categoryLower.includes('transport')) return ['#3b82f6', '#2563eb'];
            if (categoryLower.includes('matériel') || categoryLower.includes('équipement')) return ['#10b981', '#059669'];
            if (categoryLower.includes('service')) return ['#8b5cf6', '#7c3aed'];
            if (categoryLower.includes('communication')) return ['#06b6d4', '#0891b2'];
            return ['#6b7280', '#4b5563'];
        };

        const [primaryColor, secondaryColor] = getCategoryColor();

        const amount = extractAmountFromDisplayName(expense.display_name);
        const currency = expense.currency_id && expense.currency_id.length > 1
            ? expense.currency_id[1]
            : 'MAD';

        return (
            <TouchableOpacity
                style={styles.expenseCard}
                activeOpacity={0.7}
                onPress={() => handleExpensePress(expense)}
            >
                {/* Gradient Border Effect */}
                <View style={[styles.gradientBorder, {borderLeftColor: primaryColor}]}/>

                <View style={styles.expenseCardContent}>
                    {/* Header Section */}
                    <View style={styles.expenseHeader}>
                        <View style={styles.expenseHeaderLeft}>
                            {/* Modern Icon Container */}
                            <View style={[styles.modernIconContainer, {backgroundColor: `${primaryColor}10`}]}>
                                <View style={[styles.iconGradient, {backgroundColor: primaryColor}]}>
                                    <Ionicons name="wallet" size={18} color="#ffffff"/>
                                </View>
                            </View>

                            <View style={styles.expenseMainInfo}>
                                {/* Type Badge */}
                                <View style={styles.typeBadge}>
                                    <Text style={styles.expenseTypeName} numberOfLines={1}>
                                        {expenseTypeName}
                                    </Text>
                                </View>

                                {/* Category with Icon */}
                                <View style={styles.categoryRow}>
                                    <Ionicons name="folder-outline" size={12} color={primaryColor}/>
                                    <Text style={[styles.categoryName, {color: primaryColor}]} numberOfLines={1}>
                                        {expenseCategoryName}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* Amount Section - Prominent */}
                        <View style={styles.amountSection}>
                            <Text style={styles.expenseAmountLarge}>{amount}</Text>
                            <Text style={styles.currencyLabel}>{currency}</Text>
                        </View>
                    </View>

                    {/* Footer Section */}
                    <View style={styles.expenseFooter}>
                        <View style={styles.dateContainer}>
                            <Ionicons name="calendar-outline" size={14} color="#9ca3af"/>
                            <Text style={styles.dateText}>
                                {formatDate(expense.expense_date)}
                            </Text>
                        </View>

                        <View style={styles.idBadge}>
                            <Text style={styles.idText}>#{expense.id}</Text>
                        </View>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <>
                <Stack.Screen options={{headerShown: false}}/>
                <View style={styles.loadingContainer}>
                    <StatusBar barStyle="light-content" backgroundColor="#2563eb"/>
                    <Text style={styles.loadingText}>Chargement...</Text>
                </View>
            </>
        );
    }

    if (!task) {
        return (
            <>
                <Stack.Screen options={{headerShown: false}}/>
                <View style={styles.errorContainer}>
                    <StatusBar barStyle="light-content" backgroundColor="#2563eb"/>
                    <Text style={styles.errorText}>Tâche non trouvée</Text>
                </View>
            </>
        );
    }

    // @ts-ignore
    return (
        <>
            <Stack.Screen options={{headerShown: false}}/>
            <View style={styles.container}>
                <StatusBar barStyle="light-content" backgroundColor="#2563eb"/>

                {/* Refresh Indicator - Same as index */}
                {refreshing && (
                    <View style={styles.refreshOverlay}>
                        <View style={styles.refreshCard}>
                            <Animated.View style={{transform: [{rotate: spin}]}}>
                                <Ionicons name="reload" size={40} color="#3b82f6"/>
                            </Animated.View>
                            <Text style={styles.refreshOverlayText}>Actualisation...</Text>
                        </View>
                    </View>
                )}

                {/* Fixed Header */}
                <View style={styles.header}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                    >
                        <Ionicons name="arrow-back" size={24} color="#ffffff"/>
                    </TouchableOpacity>
                    <View style={styles.headerContent}>
                        <Text style={styles.headerTitle} numberOfLines={1}>
                            Dépenses
                        </Text>
                        <Text style={styles.headerSubtitle} numberOfLines={1}>
                            {task.name}
                        </Text>
                    </View>
                    <View style={styles.timerContainer}>
                        <View style={styles.timerButtonsContainer}>
                            {/* ✅ START BUTTON - Visible seulement quand stopped */}
                            {timerState === 'stopped' && (
                                <TouchableOpacity
                                    style={[
                                        styles.timerButton,
                                        styles.startButton
                                    ]}
                                    onPress={handleStartTimer}
                                >
                                    <Ionicons
                                        name="play"
                                        size={18}
                                        color="#ffffff"
                                    />
                                </TouchableOpacity>
                            )}

                            {/* ✅ PAUSE BUTTON - Visible seulement quand running */}
                            {timerState === 'running' && (
                                <TouchableOpacity
                                    style={[
                                        styles.timerButton,
                                        styles.pauseButton
                                    ]}
                                    onPress={handlePauseTimer}
                                >
                                    <Ionicons
                                        name="pause"
                                        size={18}
                                        color="#ffffff"
                                    />
                                </TouchableOpacity>
                            )}

                            {/* ✅ RESUME BUTTON - Visible seulement quand paused */}
                            {timerState === 'paused' && (
                                <TouchableOpacity
                                    style={[
                                        styles.timerButton,
                                        styles.resumeButton
                                    ]}
                                    onPress={handleResumeTimer}
                                >
                                    <Ionicons
                                        name="play-forward"
                                        size={18}
                                        color="#ffffff"
                                    />
                                </TouchableOpacity>
                            )}

                            {/* ✅ STOP BUTTON - Visible quand running ou paused */}
                            {(timerState === 'running' || timerState === 'paused') && (
                                <TouchableOpacity
                                    style={[
                                        styles.timerButton,
                                        styles.stopButton
                                    ]}
                                    onPress={handleStopTimer}
                                >
                                    <Ionicons
                                        name="stop"
                                        size={18}
                                        color="#ffffff"
                                    />
                                </TouchableOpacity>
                            )}
                        </View>

                        {/* ✅ TEMPS ÉCOULÉ - Affichage sous les boutons */}
                        <Text style={styles.timerText}>{elapsedTime}</Text>
                    </View>
                </View>

                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={onRefresh}/>
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {/* Breadcrumb */}
                    <View style={styles.breadcrumbWrapper}>
                        <ScrollView
                            horizontal={true}
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.breadcrumbScrollContent}
                            style={styles.breadcrumbScrollView}
                        >
                            <TouchableOpacity
                                style={styles.breadcrumbItem}
                                onPress={() => router.push('/(tabs)/')}
                            >
                                <Ionicons name="home-outline" size={14} color="#6b7280"/>
                                <Text style={styles.breadcrumbText}>Projets</Text>
                            </TouchableOpacity>
                            <Ionicons name="chevron-forward" size={12} color="#d1d5db"/>
                            <View style={styles.breadcrumbItem}>
                                <Ionicons name="briefcase" size={14} color="#6b7280"/>
                                <Text style={styles.breadcrumbText}>{params.projectName || 'Projet'}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={12} color="#d1d5db"/>
                            <View style={styles.breadcrumbItem}>
                                <Ionicons name="receipt" size={14} color="#3b82f6"/>
                                <Text style={[styles.breadcrumbText, styles.breadcrumbActive]}>
                                    Dépenses
                                </Text>
                            </View>
                        </ScrollView>
                    </View>

                    {/* Task Info Card */}
                    <View style={styles.taskInfoCard}>
                        {/* En-tête avec titre */}
                        <View style={styles.taskInfoHeader}>
                            <View style={styles.taskIconContainer}>
                                <Ionicons name="clipboard" size={28} color="#3b82f6"/>
                            </View>
                            <View style={styles.taskInfoTitleContainer}>
                                <Text style={styles.taskInfoTitle}>{task.name}</Text>
                            </View>
                        </View>

                        {/* Séparateur */}
                        <View style={styles.taskInfoDivider} />

                        {/* Informations principales */}
                        <View style={styles.taskInfoSection}>
                            {/* Projet */}
                            <View style={styles.taskInfoRow}>
                                <View style={styles.taskInfoLabelContainer}>
                                    <Ionicons name="briefcase-outline" size={18} color="#6b7280"/>
                                    <Text style={styles.taskInfoLabel}>Projet</Text>
                                </View>
                                <Text style={styles.taskInfoValue} numberOfLines={2}>
                                    {params.projectName || 'Non défini'}
                                </Text>
                            </View>

                            {/* Assigné à */}
                            {task.user_ids && task.user_ids.length > 0 && (
                                <View style={styles.taskInfoRow}>
                                    <View style={styles.taskInfoLabelContainer}>
                                        <Ionicons name="people-outline" size={18} color="#6b7280"/>
                                        <Text style={styles.taskInfoLabel}>Assigné à</Text>
                                    </View>
                                    <Text style={styles.taskInfoValue} numberOfLines={2}>
                                        {task.user_ids.map(user => user.name).join(', ')}
                                    </Text>
                                </View>
                            )}
                        </View>

                        {/* Section avances (si présentes) */}
                        {((task.advance_amount !== undefined && task.advance_amount !== null && task.advance_amount > 0) || task.advance_date) && (
                            <>
                                <View style={styles.taskInfoDivider} />
                                <View style={styles.taskAdvanceSection}>
                                    <View style={styles.advanceSectionHeader}>
                                        <Ionicons name="wallet-outline" size={18} color="#8b5cf6"/>
                                        <Text style={styles.advanceSectionTitle}>Avances</Text>
                                    </View>
                                    <View style={styles.advanceBadgesContainer}>
                                        {/* 💰 Montant d'avance */}
                                        {task.advance_amount !== undefined && task.advance_amount !== null && task.advance_amount > 0 && (
                                            <View style={styles.avanceAmountBadge}>
                                                <Ionicons name="cash" size={16} color="#10b981"/>
                                                <View style={styles.avanceBadgeContent}>
                                                    <Text style={styles.avanceBadgeLabel}>Montant</Text>
                                                    <Text style={styles.avanceAmountValue}>
                                                        {task.advance_amount.toFixed(2)} MAD
                                                    </Text>
                                                </View>
                                            </View>
                                        )}
                                        {/* 📅 Date d'avance */}
                                        {task.advance_date && (
                                            <View style={styles.avanceDateBadge}>
                                                <Ionicons name="calendar" size={16} color="#3b82f6"/>
                                                <View style={styles.avanceBadgeContent}>
                                                    <Text style={styles.avanceBadgeLabel}>Date</Text>
                                                    <Text style={styles.avanceDateValue}>
                                                        {formatDate(task.advance_date)}
                                                    </Text>
                                                </View>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            </>
                        )}
                    </View>

                    {/* Expenses List */}
                    <View style={styles.expensesContainer}>
                        <View style={styles.expensesHeader}>
                            <Text style={styles.sectionTitle}>
                                Liste des dépenses ({task.expense_ids?.length || 0})
                            </Text>
                            <TouchableOpacity
                                style={styles.addExpenseButton}
                                onPress={handleAddExpense}
                            >
                                <Ionicons name="add" size={20} color="#3b82f6"/>
                                <Text style={styles.addExpenseText}>Ajouter</Text>
                            </TouchableOpacity>
                        </View>

                        {task.expense_ids && task.expense_ids.length > 0 ? (
                            (() => {
                                return task.expense_ids.map((expense, index) => (
                                    <ExpenseCard key={expense.id || index} expense={expense}/>
                                ));
                            })()
                        ) : (
                            <View style={styles.emptyContainer}>
                                <Ionicons name="receipt-outline" size={48} color="#9ca3af"/>
                                <Text style={styles.emptyText}>Aucune dépense pour cette tâche</Text>
                                <Text style={styles.emptySubtext}>
                                    Ajoutez des dépenses pour suivre les coûts de cette tâche
                                </Text>
                                <TouchableOpacity
                                    style={styles.addFirstExpenseButton}
                                    onPress={handleAddExpense}
                                >
                                    <Ionicons name="add-circle-outline" size={20} color="#ffffff"/>
                                    <Text style={styles.addFirstExpenseText}>Ajouter la première dépense</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                </ScrollView>

                {/* Modal pour ajouter une dépense */}
                <Modal
                    animationType="fade"
                    transparent={true}
                    visible={modalVisible}
                    onRequestClose={handleCancelExpense}
                >
                    <KeyboardAvoidingView
                        style={styles.modalOverlay}
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    >
                        <Pressable
                            style={styles.modalPressable}
                            onPress={handleCancelExpense}
                        >
                            <Pressable
                                style={styles.modalContainer}
                                onPress={() => {
                                }}
                            >
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Nouvelle dépense</Text>
                                    <TouchableOpacity
                                        onPress={handleCancelExpense}
                                        style={styles.modalCloseButton}
                                    >
                                        <Ionicons name="close" size={24} color="#6b7280"/>
                                    </TouchableOpacity>
                                </View>

                                <ScrollView
                                    style={styles.modalScrollView}
                                    contentContainerStyle={styles.modalScrollContent}
                                    showsVerticalScrollIndicator={false}
                                    keyboardShouldPersistTaps="handled"
                                >
                                    {/* Catégorie de dépense */}
                                    <View style={styles.inputGroup}>
                                        <Text style={styles.inputLabel}>Catégorie</Text>
                                        <TouchableOpacity
                                            style={styles.selectButton}
                                            onPress={() => {
                                                setShowCategoryDropdown(!showCategoryDropdown);
                                                setShowTypeDropdown(false);
                                            }}
                                        >
                                            <View style={styles.selectContent}>
                                                {selectedCategory ? (
                                                    <>
                                                        <Ionicons name="folder" size={20} color="#3b82f6"/>
                                                        <Text style={styles.selectText}>{selectedCategory.name}</Text>
                                                    </>
                                                ) : (
                                                    <Text style={[styles.selectText, {color: '#9ca3af'}]}>
                                                        Sélectionner une catégorie
                                                    </Text>
                                                )}
                                            </View>
                                            <Ionicons
                                                name={showCategoryDropdown ? "chevron-up" : "chevron-down"}
                                                size={20}
                                                color="#6b7280"
                                            />
                                        </TouchableOpacity>

                                        {showCategoryDropdown && (
                                            <View style={styles.dropdown}>
                                                {loadingCategories ? (
                                                    <View style={styles.dropdownItem}>
                                                        <Text style={styles.dropdownItemText}>Chargement...</Text>
                                                    </View>
                                                ) : expenseCategories.length > 0 ? (
                                                    expenseCategories.map((category) => (
                                                        <TouchableOpacity
                                                            key={category.id}
                                                            style={[
                                                                styles.dropdownItem,
                                                                selectedCategory?.id === category.id && styles.dropdownItemSelected
                                                            ]}
                                                            onPress={() => {
                                                                setSelectedCategory(category);
                                                                setNewExpenseType(''); // Reset type when category changes
                                                                setShowCategoryDropdown(false);
                                                            }}
                                                        >
                                                            <Ionicons name="folder" size={20} color="#3b82f6"/>
                                                            <View style={{flex: 1, marginLeft: 10}}>
                                                                <Text style={[
                                                                    styles.dropdownItemText,
                                                                    selectedCategory?.id === category.id && styles.dropdownItemTextSelected
                                                                ]}>
                                                                    {category.name}
                                                                </Text>
                                                                <Text style={styles.dropdownItemSubtext}>
                                                                    {category.expense_type_ids.length} types
                                                                </Text>
                                                            </View>
                                                            {selectedCategory?.id === category.id && (
                                                                <Ionicons name="checkmark" size={20} color="#3b82f6"/>
                                                            )}
                                                        </TouchableOpacity>
                                                    ))
                                                ) : (
                                                    <View style={styles.dropdownItem}>
                                                        <Text style={styles.dropdownItemText}>Aucune catégorie
                                                            disponible</Text>
                                                    </View>
                                                )}
                                            </View>
                                        )}
                                    </View>

                                    {/* Type de dépense */}
                                    {selectedCategory && (
                                        <View style={styles.inputGroup}>
                                            <Text style={styles.inputLabel}>Type de dépense</Text>
                                            <TouchableOpacity
                                                style={styles.selectButton}
                                                onPress={() => {
                                                    setShowTypeDropdown(!showTypeDropdown);
                                                    setShowCategoryDropdown(false);
                                                }}
                                            >
                                                <View style={styles.selectContent}>
                                                    {newExpenseType ? (
                                                        <>
                                                            <Ionicons name="pricetag" size={20} color="#10b981"/>
                                                            <Text style={styles.selectText}>
                                                                {selectedCategory.expense_type_ids.find(t => t.id.toString() === newExpenseType)?.name || 'Sélectionner'}
                                                            </Text>
                                                        </>
                                                    ) : (
                                                        <Text style={[styles.selectText, {color: '#9ca3af'}]}>
                                                            Sélectionner un type
                                                        </Text>
                                                    )}
                                                </View>
                                                <Ionicons
                                                    name={showTypeDropdown ? "chevron-up" : "chevron-down"}
                                                    size={20}
                                                    color="#6b7280"
                                                />
                                            </TouchableOpacity>

                                            {showTypeDropdown && (
                                                <View style={styles.dropdown}>
                                                    {selectedCategory.expense_type_ids.map((type) => (
                                                        <TouchableOpacity
                                                            key={type.id}
                                                            style={[
                                                                styles.dropdownItem,
                                                                newExpenseType === type.id.toString() && styles.dropdownItemSelected
                                                            ]}
                                                            onPress={() => {
                                                                setNewExpenseType(type.id.toString());
                                                                setShowTypeDropdown(false);
                                                            }}
                                                        >
                                                            <Ionicons name="pricetag" size={20} color="#10b981"/>
                                                            <Text style={[
                                                                styles.dropdownItemText,
                                                                newExpenseType === type.id.toString() && styles.dropdownItemTextSelected
                                                            ]}>
                                                                {type.name}
                                                            </Text>
                                                            {newExpenseType === type.id.toString() && (
                                                                <Ionicons name="checkmark" size={20} color="#3b82f6"/>
                                                            )}
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                            )}
                                        </View>
                                    )}

                                    {/* Description */}
                                    <View style={styles.inputGroup}>
                                        <Text style={styles.inputLabel}>Description</Text>
                                        <TextInput
                                            style={styles.descriptionInput}
                                            value={newExpenseDescription}
                                            onChangeText={setNewExpenseDescription}
                                            placeholder="Ex: Achat de matériel, frais de transport..."
                                            multiline={true}
                                            numberOfLines={3}
                                            textAlignVertical="top"
                                            returnKeyType="done"
                                            blurOnSubmit={true}
                                        />
                                    </View>

                                    {/* Montant */}
                                    <View style={styles.inputGroup}>
                                        <Text style={styles.inputLabel}>Montant (MAD)</Text>
                                        <View style={styles.amountInputContainer}>
                                            <TextInput
                                                style={styles.amountInput}
                                                value={newExpenseAmount}
                                                onChangeText={setNewExpenseAmount}
                                                placeholder="0.00"
                                                keyboardType="decimal-pad"
                                                returnKeyType="done"
                                                blurOnSubmit={true}
                                            />
                                            <Text style={styles.currencyLabel}>MAD</Text>
                                        </View>
                                    </View>
                                </ScrollView>

                                <View style={styles.modalActions}>
                                    <TouchableOpacity
                                        style={styles.cancelButton}
                                        onPress={handleCancelExpense}
                                    >
                                        <Text style={styles.cancelButtonText}>Annuler</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.saveButton}
                                        onPress={handleSaveExpense}
                                    >
                                        <Text style={styles.saveButtonText}>Ajouter</Text>
                                    </TouchableOpacity>
                                </View>
                            </Pressable>
                        </Pressable>
                    </KeyboardAvoidingView>
                </Modal>

                {/* Modal pour afficher les détails d'une dépense */}
                <Modal
                    animationType="fade"
                    transparent={true}
                    visible={expenseDetailsVisible}
                    onRequestClose={() => setExpenseDetailsVisible(false)}
                >
                    <KeyboardAvoidingView
                        style={styles.detailsModalOverlay}
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    >
                        <View style={styles.detailsModalContainer}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>💰 Détails de la dépense</Text>
                                <TouchableOpacity
                                    onPress={() => setExpenseDetailsVisible(false)}
                                    style={styles.modalCloseButton}
                                >
                                    <Ionicons name="close" size={24} color="#6b7280"/>
                                </TouchableOpacity>
                            </View>

                            <ScrollView
                                style={styles.detailsScrollView}
                                contentContainerStyle={styles.detailsScrollContent}
                                showsVerticalScrollIndicator={true}
                                bounces={true}
                            >
                                {selectedExpense && (
                                    <View style={styles.expenseDetailsContainer}>
                                        {/* ID Badge */}
                                        <View style={styles.detailsIdBadge}>
                                            <Ionicons name="receipt" size={20} color="#3b82f6"/>
                                            <Text style={styles.detailsIdText}>Dépense #{selectedExpense.id}</Text>
                                        </View>

                                        {/* Montant principal */}
                                        <View style={styles.detailsAmountSection}>
                                            <Text style={styles.detailsAmountLabel}>Montant</Text>
                                            <View style={styles.detailsAmountBox}>
                                                <Text style={styles.detailsAmountValue}>
                                                    {extractAmountFromDisplayName(selectedExpense.display_name)}
                                                </Text>
                                                <Text style={styles.detailsAmountCurrency}>
                                                    {selectedExpense.currency_id && selectedExpense.currency_id.length > 1
                                                        ? selectedExpense.currency_id[1]
                                                        : 'MAD'}
                                                </Text>
                                            </View>
                                        </View>

                                        {/* Catégorie */}
                                        <View style={styles.detailsInfoRow}>
                                            <View style={styles.detailsInfoLabel}>
                                                <Ionicons name="folder" size={18} color="#8b5cf6"/>
                                                <Text style={styles.detailsInfoLabelText}>Catégorie</Text>
                                            </View>
                                            <Text style={styles.detailsInfoValue}>
                                                {selectedExpense.expense_category_id && selectedExpense.expense_category_id.length > 0
                                                    ? selectedExpense.expense_category_id[0].name
                                                    : 'Non catégorisé'}
                                            </Text>
                                        </View>

                                        {/* Type */}
                                        <View style={styles.detailsInfoRow}>
                                            <View style={styles.detailsInfoLabel}>
                                                <Ionicons name="pricetag" size={18} color="#10b981"/>
                                                <Text style={styles.detailsInfoLabelText}>Type</Text>
                                            </View>
                                            <Text style={styles.detailsInfoValue}>
                                                {selectedExpense.expense_type_id && selectedExpense.expense_type_id.length > 0
                                                    ? selectedExpense.expense_type_id[0].name
                                                    : 'Type non défini'}
                                            </Text>
                                        </View>

                                        {/* Description */}
                                        {selectedExpense.description && selectedExpense.description.trim() !== '' && (
                                            <View style={styles.detailsDescriptionSection}>
                                                <View style={styles.detailsInfoLabel}>
                                                    <Ionicons name="document-text" size={18} color="#f59e0b"/>
                                                    <Text style={styles.detailsInfoLabelText}>Description</Text>
                                                </View>
                                                <View style={styles.detailsDescriptionBox}>
                                                    <Text style={styles.detailsDescriptionText}>
                                                        {selectedExpense.description}
                                                    </Text>
                                                </View>
                                            </View>
                                        )}

                                        {/* Date */}
                                        <View style={styles.detailsInfoRow}>
                                            <View style={styles.detailsInfoLabel}>
                                                <Ionicons name="calendar" size={18} color="#3b82f6"/>
                                                <Text style={styles.detailsInfoLabelText}>Date</Text>
                                            </View>
                                            <Text style={styles.detailsInfoValue}>
                                                {formatDate(selectedExpense.expense_date)}
                                            </Text>
                                        </View>

                                        {/* Projet */}
                                        {selectedExpense.project_id && selectedExpense.project_id.length > 1 && (
                                            <View style={styles.detailsInfoRow}>
                                                <View style={styles.detailsInfoLabel}>
                                                    <Ionicons name="briefcase" size={18} color="#f59e0b"/>
                                                    <Text style={styles.detailsInfoLabelText}>Projet</Text>
                                                </View>
                                                <Text style={[styles.detailsInfoValue, {flex: 1, textAlign: 'right'}]}
                                                      numberOfLines={2}>
                                                    {selectedExpense.project_id[1]}
                                                </Text>
                                            </View>
                                        )}

                                        {/* Tâche */}
                                        {selectedExpense.task_id && selectedExpense.task_id.length > 1 && (
                                            <View style={styles.detailsInfoRow}>
                                                <View style={styles.detailsInfoLabel}>
                                                    <Ionicons name="clipboard" size={18} color="#06b6d4"/>
                                                    <Text style={styles.detailsInfoLabelText}>Tâche</Text>
                                                </View>
                                                <Text style={[styles.detailsInfoValue, {flex: 1, textAlign: 'right'}]}
                                                      numberOfLines={2}>
                                                    {selectedExpense.task_id[1]}
                                                </Text>
                                            </View>
                                        )}

                                        {/* Display Name complet */}
                                        {selectedExpense.display_name && (
                                            <View style={styles.detailsDisplayNameSection}>
                                                <Text style={styles.detailsDisplayNameLabel}>Description complète</Text>
                                                <View style={styles.detailsDisplayNameBox}>
                                                    <Text style={styles.detailsDisplayNameText}>
                                                        {selectedExpense.display_name}
                                                    </Text>
                                                </View>
                                            </View>
                                        )}

                                        {/* Données techniques */}
                                        <View style={styles.detailsTechnicalSection}>
                                            <Text style={styles.detailsTechnicalTitle}>
                                                <Ionicons name="information-circle" size={16} color="#6b7280"/>
                                                {' '}Informations techniques
                                            </Text>
                                            <View style={styles.detailsTechnicalBox}>
                                                <Text style={styles.detailsTechnicalText}>
                                                    ID
                                                    Catégorie: {selectedExpense.expense_category_id?.[0]?.id || 'N/A'}
                                                </Text>
                                                <Text style={styles.detailsTechnicalText}>
                                                    ID Type: {selectedExpense.expense_type_id?.[0]?.id || 'N/A'}
                                                </Text>
                                                <Text style={styles.detailsTechnicalText}>
                                                    ID Devise: {selectedExpense.currency_id?.[0] || 'N/A'}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>
                                )}
                            </ScrollView>

                            <View style={styles.modalActions}>
                                <TouchableOpacity
                                    style={[styles.saveButton, {flex: 1}]}
                                    onPress={() => setExpenseDetailsVisible(false)}
                                >
                                    <Text style={styles.saveButtonText}>Fermer</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                </Modal>
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    refreshOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
    },
    refreshCard: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 32,
        paddingVertical: 24,
        borderRadius: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
    },
    refreshOverlayText: {
        marginTop: 12,
        fontSize: 16,
        fontWeight: '600',
        color: '#2563eb',
    },
    header: {
        backgroundColor: '#2563eb',
        paddingTop: 60,
        paddingBottom: 20,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    headerContent: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#ffffff',
    },
    headerSubtitle: {
        fontSize: 14,
        color: 'rgba(255, 255, 255, 0.8)',
        marginTop: 2,
    },
    timerButtonsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    timerContainer: {
        alignItems: 'center',
        marginLeft: 16,
    },
    timerButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
    startButton: {
        backgroundColor: 'rgba(16, 185, 129, 0.2)',
    },
    resumeButton: {
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
    },
    debugButton: {
        backgroundColor: 'rgba(107, 114, 128, 0.2)',
    },
    pauseButton: {
        backgroundColor: 'rgba(245, 158, 11, 0.2)',
    },
    stopButton: {
        backgroundColor: 'rgba(239, 68, 68, 0.2)',
    },
    activeButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingTop: 140,
        paddingBottom: 100,
    },
    breadcrumbWrapper: {
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        paddingVertical: 12,
    },
    breadcrumbScrollView: {
        flexGrow: 0,
    },
    breadcrumbScrollContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    breadcrumbItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 4,
        minWidth: 'auto',
    },
    breadcrumbText: {
        fontSize: 12,
        color: '#6b7280',
        marginLeft: 4,
        fontWeight: '500',
    },
    breadcrumbActive: {
        color: '#3b82f6',
        fontWeight: '600',
    },
    taskInfoCard: {
        backgroundColor: '#ffffff',
        marginHorizontal: 20,
        marginTop: 10,
        marginBottom: 20,
        borderRadius: 20,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 4},
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
    },
    taskInfoHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 20,
        paddingBottom: 16,
    },
    taskIconContainer: {
        width: 56,
        height: 56,
        borderRadius: 16,
        backgroundColor: '#eff6ff',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    taskInfoTitleContainer: {
        flex: 1,
    },
    taskInfoTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#1f2937',
        lineHeight: 28,
    },
    taskInfoDivider: {
        height: 1,
        backgroundColor: '#f3f4f6',
        marginHorizontal: 20,
    },
    taskInfoSection: {
        padding: 20,
        paddingTop: 16,
        paddingBottom: 16,
    },
    taskInfoRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 12,
    },
    taskInfoLabelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 100,
    },
    taskInfoLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
    },
    taskInfoValue: {
        fontSize: 14,
        fontWeight: '500',
        color: '#1f2937',
        flex: 1,
        textAlign: 'right',
        marginLeft: 12,
    },
    // Section avances
    taskAdvanceSection: {
        padding: 20,
        paddingTop: 16,
        paddingBottom: 20,
        backgroundColor: '#faf5ff',
    },
    advanceSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
    },
    advanceSectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#8b5cf6',
        letterSpacing: 0.2,
    },
    advanceBadgesContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    // 💰 Badge montant d'avance
    avanceAmountBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 2,
        borderColor: '#10b981',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
        flex: 1,
        minWidth: 140,
        shadowColor: '#10b981',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    // 📅 Badge date d'avance
    avanceDateBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        borderWidth: 2,
        borderColor: '#3b82f6',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 10,
        flex: 1,
        minWidth: 140,
        shadowColor: '#3b82f6',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    avanceBadgeContent: {
        flex: 1,
    },
    avanceBadgeLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: '#9ca3af',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    avanceAmountValue: {
        fontSize: 16,
        fontWeight: '800',
        color: '#047857',
        letterSpacing: -0.3,
    },
    avanceDateValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1e40af',
        letterSpacing: -0.2,
    },
    summaryCard: {
        backgroundColor: '#ffffff',
        marginHorizontal: 20,
        marginBottom: 20,
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    summaryGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    summaryItem: {
        alignItems: 'center',
    },
    summaryValue: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 4,
    },
    summaryLabel: {
        fontSize: 12,
        color: '#6b7280',
        textAlign: 'center',
        fontWeight: '500',
    },
    summaryCard: {
        backgroundColor: '#ffffff',
        marginHorizontal: 20,
        marginBottom: 20,
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 16,
    },
    summaryGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
    },
    summaryItem: {
        alignItems: 'center',
    },
    summaryValue: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#1f2937',
        marginBottom: 4,
    },
    summaryLabel: {
        fontSize: 12,
        color: '#6b7280',
        textAlign: 'center',
        fontWeight: '500',
    },
    expensesContainer: {
        paddingHorizontal: 20,
    },
    expensesHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    addExpenseButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#3b82f6',
    },
    addExpenseText: {
        fontSize: 14,
        color: '#3b82f6',
        fontWeight: '600',
        marginLeft: 4,
    },
    expenseCard: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 4},
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 5,
        overflow: 'hidden',
        position: 'relative',
    },
    gradientBorder: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 5,
    },
    expenseCardContent: {
        padding: 20,
        paddingLeft: 24,
    },
    expenseHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 16,
    },
    expenseHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
        marginRight: 16,
    },
    modernIconContainer: {
        width: 48,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    iconGradient: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    expenseMainInfo: {
        flex: 1,
    },
    typeBadge: {
        marginBottom: 8,
    },
    expenseTypeName: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1f2937',
        letterSpacing: -0.3,
    },
    categoryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    categoryName: {
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
    amountSection: {
        alignItems: 'flex-end',
        backgroundColor: '#f8fafc',
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
    },
    expenseAmountLarge: {
        fontSize: 24,
        fontWeight: '800',
        color: '#1f2937',
        letterSpacing: -0.5,
    },
    currencyLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
        marginTop: 2,
        letterSpacing: 0.5,
    },
    expenseFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    dateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    dateText: {
        fontSize: 13,
        color: '#6b7280',
        fontWeight: '500',
    },
    idBadge: {
        backgroundColor: '#f3f4f6',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
    },
    idText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6b7280',
        letterSpacing: 0.5,
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        borderRadius: 16,
        marginTop: 20,
    },
    emptyText: {
        fontSize: 18,
        color: '#9ca3af',
        marginTop: 16,
        textAlign: 'center',
        fontWeight: '600',
    },
    emptySubtext: {
        fontSize: 14,
        color: '#9ca3af',
        marginTop: 8,
        textAlign: 'center',
        lineHeight: 20,
    },
    addFirstExpenseButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#3b82f6',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        marginTop: 20,
    },
    addFirstExpenseText: {
        fontSize: 16,
        color: '#ffffff',
        fontWeight: '600',
        marginLeft: 8,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#2563eb',
    },
    loadingText: {
        color: '#ffffff',
        fontSize: 16,
        marginTop: 12,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#dc2626',
    },
    errorText: {
        color: '#ffffff',
        fontSize: 16,
    },
    // Modal Styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalPressable: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
    },
    modalContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        width: 350,
        minWidth: 350,
        maxWidth: 350,
        maxHeight: '85%',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 10},
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        flexShrink: 0,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1f2937',
    },
    modalCloseButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f9fafb',
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalScrollView: {
        flexGrow: 0,
        maxHeight: 450,
        width: '100%',
    },
    modalScrollContent: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        paddingBottom: 20,
        width: '100%',
    },
    inputGroup: {
        marginBottom: 20,
    },
    inputLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    selectButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        width: '100%',
        minHeight: 48,
    },
    selectContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    selectText: {
        fontSize: 16,
        color: '#1f2937',
        marginLeft: 10,
        fontWeight: '500',
    },
    dropdown: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 12,
        marginTop: 4,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        zIndex: 9999,
        position: 'relative',
    },
    dropdownItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    dropdownItemSelected: {
        backgroundColor: '#eff6ff',
    },
    dropdownItemText: {
        fontSize: 16,
        color: '#1f2937',
        marginLeft: 10,
        flex: 1,
    },
    dropdownItemTextSelected: {
        color: '#3b82f6',
        fontWeight: '600',
    },
    dropdownItemSubtext: {
        fontSize: 12,
        color: '#9ca3af',
        marginTop: 2,
    },
    amountInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 12,
        paddingHorizontal: 16,
        width: '100%',
        minHeight: 48,
    },
    descriptionInput: {
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        fontSize: 16,
        color: '#1f2937',
        minHeight: 80,
        maxHeight: 120,
        width: '100%',
        textAlignVertical: 'top',
    },
    amountInput: {
        flex: 1,
        fontSize: 16,
        color: '#1f2937',
        paddingVertical: 12,
        textAlign: 'right',
    },
    currencyLabel: {
        fontSize: 16,
        color: '#6b7280',
        fontWeight: '600',
        marginLeft: 8,
    },
    modalActions: {
        flexDirection: 'row',
        paddingHorizontal: 20,
        paddingVertical: 20,
        gap: 12,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        flexShrink: 0,
    },
    cancelButton: {
        flex: 1,
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    cancelButtonText: {
        fontSize: 16,
        color: '#6b7280',
        fontWeight: '600',
    },
    saveButton: {
        flex: 1,
        backgroundColor: '#3b82f6',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    saveButtonText: {
        fontSize: 16,
        color: '#ffffff',
        fontWeight: '600',
    },
    timerText: {
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.9)',
        fontWeight: '600',
        marginTop: 4,
        fontFamily: 'monospace',
    },
    // 💰 Styles pour le modal de détails de dépense
    expenseDetailsContainer: {
        // Pas de padding ici car géré par detailsScrollContent
    },
    detailsIdBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
        marginBottom: 20,
        gap: 8,
    },
    detailsIdText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#3b82f6',
        letterSpacing: 0.5,
    },
    detailsAmountSection: {
        backgroundColor: '#f8fafc',
        borderRadius: 16,
        padding: 20,
        marginBottom: 20,
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#e5e7eb',
    },
    detailsAmountLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    detailsAmountBox: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    detailsAmountValue: {
        fontSize: 36,
        fontWeight: '800',
        color: '#1f2937',
        letterSpacing: -1,
    },
    detailsAmountCurrency: {
        fontSize: 20,
        fontWeight: '700',
        color: '#6b7280',
        letterSpacing: 0.5,
    },
    detailsInfoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    detailsInfoLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flex: 1,
    },
    detailsInfoLabelText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
    },
    detailsInfoValue: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1f2937',
        marginLeft: 12,
    },
    detailsDisplayNameSection: {
        marginTop: 10,
        marginBottom: 20,
    },
    detailsDisplayNameLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    detailsDisplayNameBox: {
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        minHeight: 80,
        maxHeight: 200,
    },
    detailsDisplayNameText: {
        fontSize: 14,
        color: '#374151',
        lineHeight: 22,
        flexWrap: 'wrap',
    },
    detailsTechnicalSection: {
        marginTop: 10,
        paddingTop: 20,
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    detailsTechnicalTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#6b7280',
        marginBottom: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    detailsTechnicalBox: {
        backgroundColor: '#f9fafb',
        borderRadius: 10,
        padding: 12,
        gap: 6,
    },
    detailsTechnicalText: {
        fontSize: 12,
        color: '#6b7280',
        fontFamily: 'monospace',
    },
    detailsDescriptionSection: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#fef3c7',
        borderRadius: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#fde68a',
    },
    detailsDescriptionBox: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#fde68a',
    },
    detailsDescriptionText: {
        fontSize: 14,
        color: '#92400e',
        lineHeight: 22,
        fontWeight: '500',
    },
    detailsModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    detailsModalPressable: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        paddingHorizontal: 0,
    },
    detailsModalContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        width: '100%',
        height: '90%',
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 10},
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
        display: 'flex',
        flexDirection: 'column',
    },
    detailsScrollView: {
        flex: 1,
    },
    detailsScrollContent: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        paddingBottom: 20,
    },
});
