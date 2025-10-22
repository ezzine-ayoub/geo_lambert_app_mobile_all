import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import projectService, { type ExpenseData } from '@/services/projectService';

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
      return `${(hours.toString().padStart(2, '0')>=0)?'00':hours.toString().padStart(2, '0')-1}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // ✅ Function pour normaliser la date d'Odoo
  const parseOdooDateTime = (dateStr: string | false): Date | null => {
    if (!dateStr || dateStr === false) {
      return null;
    }

    try {
      // Odoo peut retourner des dates en format ISO avec ou sans timezone
      // Ex: "2024-01-15 14:30:00" ou "2024-01-15T14:30:00Z"
      let normalizedStr = dateStr;
      
      // Si pas de 'T' et pas de timezone, ajouter 'T' et assumer UTC
      if (normalizedStr.includes(' ') && !normalizedStr.includes('T')) {
        normalizedStr = normalizedStr.replace(' ', 'T');
        // Si pas de timezone spécifiée, ajouter UTC
        if (!normalizedStr.includes('Z') && !normalizedStr.includes('+') && !normalizedStr.includes('-', 10)) {
          normalizedStr += 'Z';
        }
      }
      
      return new Date(normalizedStr);
    } catch (error) {
      console.error('❌ Erreur parsing date:', dateStr, error);
      return null;
    }
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
      
      // ✅ Debug pour voir les valeurs
      console.log('🔍 Timer Debug:', {
        timer_start: task.timer_start,
        timer_pause: task.timer_pause,
        start_parsed: new Date(task.timer_start),
        pause_parsed: task.timer_pause ? new Date(task.timer_pause) : null,
        now: new Date(),
        elapsed_seconds: elapsed,
        formatted_time: formatElapsedTime(elapsed)
      });
      
      setElapsedTime(formatElapsedTime(elapsed));
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
      } catch (error) {
        console.error('Erreur parsing task data:', error);
        Alert.alert('Erreur', 'Impossible de charger les dépenses de la tâche');
        router.back();
      }
    }
  }, [params.task]);

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

  // ✅ Cleanup interval au démontage du composant
  useEffect(() => {
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  const onRefresh = React.useCallback(() => {
    setRefreshing(true);
    // Simuler un refresh
    setTimeout(() => {
      setRefreshing(false);
    }, 1000);
  }, []);

  const getExpenseTypeIcon = (expenseType) => {
    switch (expenseType) {
      case 'sous_traitance':
        return { name: 'people-outline', color: '#8b5cf6' };
      case 'materiel':
        return { name: 'construct-outline', color: '#10b981' };
      case 'transport':
        return { name: 'car-outline', color: '#3b82f6' };
      case 'hebergement':
        return { name: 'bed-outline', color: '#f59e0b' };
      case 'repas':
        return { name: 'restaurant-outline', color: '#ef4444' };
      case 'fournitures':
        return { name: 'library-outline', color: '#06b6d4' };
      case 'communication':
        return { name: 'call-outline', color: '#84cc16' };
      case 'formation':
        return { name: 'school-outline', color: '#f97316' };
      case 'logiciel':
        return { name: 'laptop-outline', color: '#a855f7' };
      default:
        return { name: 'receipt-outline', color: '#6b7280' };
    }
  };

  const getExpenseTypeText = (expenseType) => {
    switch (expenseType) {
      case 'sous_traitance':
        return 'Sous-traitance';
      case 'materiel':
        return 'Matériel';
      case 'transport':
        return 'Transport';
      case 'hebergement':
        return 'Hébergement';
      case 'repas':
        return 'Repas';
      case 'fournitures':
        return 'Fournitures';
      case 'communication':
        return 'Communication';
      case 'formation':
        return 'Formation';
      case 'logiciel':
        return 'Logiciel';
      default:
        return 'Autre';
    }
  };

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

  const expenseTypes = [
    { value: 'sous_traitance', label: 'Sous-traitance', icon: 'people-outline', color: '#8b5cf6' },
    { value: 'materiel', label: 'Matériel', icon: 'construct-outline', color: '#10b981' },
    { value: 'transport', label: 'Transport', icon: 'car-outline', color: '#3b82f6' },
    { value: 'hebergement', label: 'Hébergement', icon: 'bed-outline', color: '#f59e0b' },
    { value: 'repas', label: 'Repas', icon: 'restaurant-outline', color: '#ef4444' },
    { value: 'fournitures', label: 'Fournitures', icon: 'library-outline', color: '#06b6d4' },
    { value: 'communication', label: 'Communication', icon: 'call-outline', color: '#84cc16' },
    { value: 'formation', label: 'Formation', icon: 'school-outline', color: '#f97316' },
    { value: 'logiciel', label: 'Logiciel', icon: 'laptop-outline', color: '#a855f7' },
    { value: 'autre', label: 'Autre', icon: 'receipt-outline', color: '#6b7280' },
  ];

  const handleAddExpense = () => {
    setModalVisible(true);
    setNewExpenseAmount('');
    setNewExpenseType('sous_traitance');
    setNewExpenseDescription('');
  };

  const handleSaveExpense = async () => {
    if (!newExpenseAmount || parseFloat(newExpenseAmount) <= 0) {
      Alert.alert('Erreur', 'Veuillez saisir un montant valide');
      return;
    }

    // La description n'est plus obligatoire

    try {
      console.log('💰 Création d\'une nouvelle dépense...');
      
      const currentDate = new Date().toISOString().split('T')[0];
      
      const expenseData: ExpenseData = {
        user_id: 2, // TODO: Récupérer l'ID utilisateur connecté
        expense_type: newExpenseType,
        amount: parseFloat(newExpenseAmount),
        description: newExpenseDescription.trim() || '', // Permettre description vide
        expense_date: currentDate
      };
      
      const response = await projectService.createExpense(task.id, expenseData);
      
      if (response.success) {
        // Créer la nouvelle dépense pour la liste locale avec les vraies valeurs
        const newExpense = {
          id: response.result?.id || Date.now(), // Utiliser l'ID retourné par le serveur
          task_id: [task.id, task.name],
          expense_type: newExpenseType,
          project_id: [task.project_id || 0, 'Projet'],
          expense_date: currentDate,
          amount: parseFloat(newExpenseAmount), // Utiliser le vrai montant saisi
          description: newExpenseDescription.trim() || '', // Description peut être vide
          display_name: `${getExpenseTypeText(newExpenseType)} - ${newExpenseAmount}.00 (${currentDate})`,
          currency_id: [1, 'MAD']
        };
        
        // Mettre à jour la tâche avec la nouvelle dépense
        const updatedTask = {
          ...task,
          expense_ids: [...(task.expense_ids || []), newExpense]
        };
        
        setTask(updatedTask);
        
        Alert.alert(
          'Succès', 
          `Dépense ajoutée avec succès !\nType: ${getExpenseTypeText(newExpenseType)}\nMontant: ${newExpenseAmount} MAD`,
          [{
            text: 'OK',
            onPress: () => {
              setModalVisible(false);
            }
          }]
        );
        console.log('✅ Dépense créée et ajoutée à la liste:', newExpense);
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
    setNewExpenseType('sous_traitance');
    setNewExpenseDescription('');
  };

  const handleStartTimer = async () => {
    try {
      console.log('▶️ Démarrage du timer pour la tâche:', task.id);
      
      const response = await projectService.startTaskTimer(task.id);
      
      if (response.success) {
        // ✅ Mettre à jour les données de la tâche avec le nouvel état du timer
        if (response.timerState) {
          const updatedTask = {
            ...task,
            timer_start: response.timerState.timer_start,
            timer_pause: response.timerState.timer_pause
          };
          setTask(updatedTask);
          
          // Déterminer le nouvel état du timer
          const newTimerState = determineTimerState(response.timerState.timer_start, response.timerState.timer_pause);
          setTimerState(newTimerState);
          
          // Recalculer le temps écoulé
          const newElapsed = calculateElapsedTime(response.timerState.timer_start, response.timerState.timer_pause);
          setElapsedTime(formatElapsedTime(newElapsed));
          
          console.log('🔄 État du timer mis à jour:', {
            timer_start: response.timerState.timer_start,
            timer_pause: response.timerState.timer_pause,
            new_state: newTimerState,
            elapsed_time: formatElapsedTime(newElapsed)
          });
        } else {
          // Fallback si pas de timerState retourné
          setTimerState('running');
        }
        
        Alert.alert(
          'Timer démarré', 
          `Le timer pour la tâche "${task.name}" a été démarré avec succès !`
        );
        console.log('✅ Timer démarré:', response.data);
      } else {
        Alert.alert(
          'Erreur', 
          response.message || 'Impossible de démarrer le timer'
        );
        console.error('❌ Erreur démarrage timer:', response.message);
      }
      
    } catch (error) {
      console.error('❌ Erreur lors du démarrage du timer:', error);
      Alert.alert(
        'Erreur', 
        'Une erreur est survenue lors du démarrage du timer'
      );
    }
  };

  const handleResumeTimer = async () => {
    try {
      console.log('▶️ Reprise du timer pour la tâche:', task.id);
      
      const response = await projectService.resumeTaskTimer(task.id);
      
      if (response.success) {
        // ✅ Mettre à jour les données de la tâche avec le nouvel état du timer
        if (response.timerState) {
          const updatedTask = {
            ...task,
            timer_start: response.timerState.timer_start,
            timer_pause: response.timerState.timer_pause
          };
          setTask(updatedTask);
          
          // Déterminer le nouvel état du timer
          const newTimerState = determineTimerState(response.timerState.timer_start, response.timerState.timer_pause);
          setTimerState(newTimerState);
          
          // Recalculer le temps écoulé
          const newElapsed = calculateElapsedTime(response.timerState.timer_start, response.timerState.timer_pause);
          setElapsedTime(formatElapsedTime(newElapsed));
          
          console.log('🔄 État du timer mis à jour (resume):', {
            timer_start: response.timerState.timer_start,
            timer_pause: response.timerState.timer_pause,
            new_state: newTimerState,
            elapsed_time: formatElapsedTime(newElapsed)
          });
        } else {
          // Fallback si pas de timerState retourné
          setTimerState('running');
        }
        
        Alert.alert(
          'Timer repris', 
          `Le timer pour la tâche "${task.name}" a été repris avec succès !`
        );
        console.log('✅ Timer repris:', response.data);
      } else {
        Alert.alert(
          'Erreur', 
          response.message || 'Impossible de reprendre le timer'
        );
        console.error('❌ Erreur reprise timer:', response.message);
      }
      
    } catch (error) {
      console.error('❌ Erreur lors de la reprise du timer:', error);
      Alert.alert(
        'Erreur', 
        'Une erreur est survenue lors de la reprise du timer'
      );
    }
  };

  // ✅ Function supprimée - maintenant on utilise handleStartTimer et handleResumeTimer séparément

  const handlePauseTimer = async () => {
    try {
      console.log('⏸️ Pause du timer pour la tâche:', task.id);
      
      const response = await projectService.pauseTaskTimer(task.id);
      
      if (response.success) {
        // ✅ Mettre à jour les données de la tâche avec le nouvel état du timer
        if (response.timerState) {
          const updatedTask = {
            ...task,
            timer_start: response.timerState.timer_start,
            timer_pause: response.timerState.timer_pause
          };
          setTask(updatedTask);
          
          // Déterminer le nouvel état du timer
          const newTimerState = determineTimerState(response.timerState.timer_start, response.timerState.timer_pause);
          setTimerState(newTimerState);
          
          // Recalculer le temps écoulé
          const newElapsed = calculateElapsedTime(response.timerState.timer_start, response.timerState.timer_pause);
          setElapsedTime(formatElapsedTime(newElapsed));
          
          console.log('🔄 État du timer mis à jour (pause):', {
            timer_start: response.timerState.timer_start,
            timer_pause: response.timerState.timer_pause,
            new_state: newTimerState,
            elapsed_time: formatElapsedTime(newElapsed)
          });
        } else {
          // Fallback si pas de timerState retourné
          setTimerState('paused');
        }
        
        Alert.alert(
          'Timer en pause', 
          `Le timer pour la tâche "${task.name}" a été mis en pause.`
        );
        console.log('✅ Timer en pause:', response.data);
      } else {
        Alert.alert(
          'Erreur', 
          response.message || 'Impossible de mettre le timer en pause'
        );
        console.error('❌ Erreur pause timer:', response.message);
      }
      
    } catch (error) {
      console.error('❌ Erreur lors de la pause du timer:', error);
      Alert.alert(
        'Erreur', 
        'Une erreur est survenue lors de la pause du timer'
      );
    }
  };

  const handleCheckTimerState = async () => {
    try {
      console.log('❓ فحص حالة timer للتâche:', task.id);
      
      const response = await projectService.getTaskTimerState(task.id);
      
      if (response.success && response.data) {
        const timerData = response.data;
        const currentState = determineTimerState(timerData.timer_start, timerData.timer_pause);
        
        let stateMessage = `État Timer pour "${task.name}":\n\n`;
        stateMessage += `• État actuel déterminé: ${currentState.toUpperCase()}\n\n`;
        
        stateMessage += `• timer_start: ${timerData.timer_start || 'false'}\n`;
        stateMessage += `• timer_pause: ${timerData.timer_pause || 'false'}\n\n`;

        if (timerData.is_timer_running !== undefined) {
          stateMessage += `• Is Running: ${timerData.is_timer_running ? 'Oui' : 'Non'}\n`;
        }
        if (timerData.effective_hours !== undefined) {
          stateMessage += `• Effective Hours: ${timerData.effective_hours}h\n`;
        }
        
        Alert.alert(
          'Timer State', 
          stateMessage,
          [{ text: 'OK' }]
        );
        
        console.log('✅ Timer state complet:', {
          timer_start: timerData.timer_start,
          timer_pause: timerData.timer_pause,
          determined_state: currentState,
          current_ui_state: timerState,
          full_data: timerData
        });
      } else {
        Alert.alert(
          'Erreur', 
          response.message || 'Impossible de récupérer l\'état du timer'
        );
        console.error('❌ Erreur timer state:', response.message);
      }
      
    } catch (error) {
      console.error('❌ Erreur lors de la vérification:', error);
      Alert.alert(
        'Erreur', 
        'Une erreur est survenue lors de la vérification de l\'état du timer'
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
            try {
              console.log('⏹️ Arrêt du timer pour la tâche:', task.id);
              
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
                // ✅ Mettre à jour les données de la tâche avec le nouvel état du timer
                if (response.timerState) {
                  const updatedTask = {
                    ...task,
                    timer_start: response.timerState.timer_start,
                    timer_pause: response.timerState.timer_pause
                  };
                  setTask(updatedTask);
                  
                  // Déterminer le nouvel état du timer
                  const newTimerState = determineTimerState(response.timerState.timer_start, response.timerState.timer_pause);
                  setTimerState(newTimerState);
                  
                  // Reset le temps si arrêté
                  if (newTimerState === 'stopped') {
                    setElapsedTime('00:00:00');
                  }
                  
                  console.log('🔄 État du timer mis à jour (stop):', {
                    timer_start: response.timerState.timer_start,
                    timer_pause: response.timerState.timer_pause,
                    new_state: newTimerState
                  });
                } else {
                  // Fallback si pas de timerState retourné
                  setTimerState('stopped');
                }
                
                Alert.alert(
                  'Timer arrêté', 
                  `Le timer pour la tâche "${task.name}" a été arrêté avec succès !`
                );
                console.log('✅ Timer arrêté:', response.data);
              } else {
                Alert.alert(
                  'Erreur', 
                  `Impossible d'arrêter le timer:\n${response.message}`
                );
                console.error('❌ Erreur arrêt timer:', response.message);
              }
              
            } catch (error) {
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

  const getSelectedExpenseType = () => {
    return expenseTypes.find(type => type.value === newExpenseType) || expenseTypes[0];
  };

  const ExpenseCard = ({ expense }) => {
    const typeIcon = getExpenseTypeIcon(expense.expense_type);
    const amount = extractAmountFromDisplayName(expense.display_name);
    // Correction: récupérer la devise depuis currency_id[1]
    const currency = expense.currency_id && expense.currency_id.length > 1
      ? expense.currency_id[1]
      : 'MAD';


    return (
      <TouchableOpacity style={styles.expenseCard} activeOpacity={0.7}>
        <View style={styles.expenseRow}>
          {/* Icône et Type */}
          <View style={styles.expenseLeft}>
            <View style={[styles.expenseIcon, { backgroundColor: `${typeIcon.color}15` }]}>
              <Ionicons name={typeIcon.name} size={20} color={typeIcon.color} />
            </View>
            <View style={styles.expenseInfo}>
              <Text style={styles.expenseType}>
                {getExpenseTypeText(expense.expense_type)}
              </Text>
              <Text style={styles.expenseDate} numberOfLines={1}>
                {formatDate(expense.expense_date)}
              </Text>
            </View>
          </View>
          
          {/* Montant */}
          <View style={styles.expenseRight}>
            <View style={styles.priceContainer}>
              <Text style={styles.expenseAmount}>{amount}</Text>
              <Text style={styles.expenseCurrency}>{currency}</Text>
            </View>
          </View>
        </View>
        
        {/* Description (si présente) */}
        {expense.display_name && (
          <Text style={styles.expenseDescription} numberOfLines={2}>
            {expense.display_name}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </>
    );
  }

  if (!task) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorContainer}>
          <StatusBar barStyle="light-content" backgroundColor="#2563eb" />
          <Text style={styles.errorText}>Tâche non trouvée</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#2563eb" />

        {/* Fixed Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
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
                <Ionicons name="home-outline" size={14} color="#6b7280" />
                <Text style={styles.breadcrumbText}>Projets</Text>
              </TouchableOpacity>
              <Ionicons name="chevron-forward" size={12} color="#d1d5db" />
              <View style={styles.breadcrumbItem}>
                <Ionicons name="briefcase" size={14} color="#6b7280" />
                <Text style={styles.breadcrumbText}>{params.projectName || 'Projet'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={12} color="#d1d5db" />
              <View style={styles.breadcrumbItem}>
                <Ionicons name="receipt" size={14} color="#3b82f6" />
                <Text style={[styles.breadcrumbText, styles.breadcrumbActive]}>
                  Dépenses
                </Text>
              </View>
            </ScrollView>
          </View>

          {/* Task Info Card */}
          <View style={styles.taskInfoCard}>
            <View style={styles.taskInfoHeader}>
              <View style={styles.taskIcon}>
                <Ionicons name="clipboard" size={24} color="#3b82f6" />
              </View>
              <View style={styles.taskInfoContent}>
                <Text style={styles.taskInfoTitle}>{task.name}</Text>
                <Text style={styles.taskInfoProject}>
                  📁 Projet: {params.projectName || 'Non défini'}
                </Text>
                {task.user_ids && task.user_ids.length > 0 && (
                  <Text style={styles.taskInfoUsers}>
                    👥 Assigné à: {task.user_ids.map(user => user.name).join(', ')}
                  </Text>
                )}
              </View>
            </View>
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
                <Ionicons name="add" size={20} color="#3b82f6" />
                <Text style={styles.addExpenseText}>Ajouter</Text>
              </TouchableOpacity>
            </View>

            {task.expense_ids && task.expense_ids.length > 0 ? (
              task.expense_ids.map((expense, index) => (
                <ExpenseCard key={expense.id || index} expense={expense} />
              ))
            ) : (
              <View style={styles.emptyContainer}>
                <Ionicons name="receipt-outline" size={48} color="#9ca3af" />
                <Text style={styles.emptyText}>Aucune dépense pour cette tâche</Text>
                <Text style={styles.emptySubtext}>
                  Ajoutez des dépenses pour suivre les coûts de cette tâche
                </Text>
                <TouchableOpacity 
                  style={styles.addFirstExpenseButton}
                  onPress={handleAddExpense}
                >
                  <Ionicons name="add-circle-outline" size={20} color="#ffffff" />
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
                onPress={() => {}}
              >
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Nouvelle dépense</Text>
                  <TouchableOpacity 
                    onPress={handleCancelExpense}
                    style={styles.modalCloseButton}
                  >
                    <Ionicons name="close" size={24} color="#6b7280" />
                  </TouchableOpacity>
                </View>

                <ScrollView 
                  style={styles.modalScrollView}
                  contentContainerStyle={styles.modalScrollContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {/* Type de dépense */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Type de dépense</Text>
                    <TouchableOpacity 
                      style={styles.selectButton}
                      onPress={() => setShowTypeDropdown(!showTypeDropdown)}
                    >
                      <View style={styles.selectContent}>
                        <Ionicons 
                          name={getSelectedExpenseType().icon} 
                          size={20} 
                          color={getSelectedExpenseType().color} 
                        />
                        <Text style={styles.selectText}>
                          {getSelectedExpenseType().label}
                        </Text>
                      </View>
                      <Ionicons 
                        name={showTypeDropdown ? "chevron-up" : "chevron-down"} 
                        size={20} 
                        color="#6b7280" 
                      />
                    </TouchableOpacity>
                    
                    {showTypeDropdown && (
                      <View style={styles.dropdown}>
                        {expenseTypes.map((type) => (
                          <TouchableOpacity
                            key={type.value}
                            style={[
                              styles.dropdownItem,
                              newExpenseType === type.value && styles.dropdownItemSelected
                            ]}
                            onPress={() => {
                              setNewExpenseType(type.value);
                              setShowTypeDropdown(false);
                            }}
                          >
                            <Ionicons name={type.icon} size={20} color={type.color} />
                            <Text style={[
                              styles.dropdownItemText,
                              newExpenseType === type.value && styles.dropdownItemTextSelected
                            ]}>
                              {type.label}
                            </Text>
                            {newExpenseType === type.value && (
                              <Ionicons name="checkmark" size={20} color="#3b82f6" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>

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
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
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
    shadowOffset: { width: 0, height: 2 },
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
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  taskInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  taskInfoContent: {
    flex: 1,
  },
  taskInfoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  taskInfoProject: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 2,
  },
  taskInfoUsers: {
    fontSize: 14,
    color: '#6b7280',
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
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
    shadowOffset: { width: 0, height: 2 },
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
    borderRadius: 16,
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expenseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  expenseIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  expenseInfo: {
    flex: 1,
  },
  expenseType: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 2,
  },
  expenseDate: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  expenseRight: {
    alignItems: 'flex-end',
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  expenseAmount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#dc2626',
  },
  expenseCurrency: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '600',
  },
  expenseDescription: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 10,
    lineHeight: 18,
    paddingLeft: 52,
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
    shadowOffset: { width: 0, height: 10 },
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
    maxHeight: 350,
    width: '100%',
  },
  modalScrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 10,
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
    shadowOffset: { width: 0, height: 2 },
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
});
