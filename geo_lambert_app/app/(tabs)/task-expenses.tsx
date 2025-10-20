import React, {useEffect, useState, useRef, useMemo, useCallback} from 'react';
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
    useWindowDimensions,
    ActivityIndicator,
} from 'react-native';
import RenderHtml from 'react-native-render-html';
import DateTimePicker from '@react-native-community/datetimepicker';
import {Ionicons} from '@expo/vector-icons';
import {useLocalSearchParams, router, Stack} from 'expo-router';
import Breadcrumb, { BreadcrumbItem } from '@/components/navigation/Breadcrumb';
import projectCategoryService, {
    type ExpenseData,
    subscribeToCategoryUpdates,
    subscribeToProjectUpdates,
    subscribeToProjectsCleared,
    subscribeToProjectDeleted,
    subscribeToTaskDeleted
} from '@/services/projectCategoryService';
import expenseCategoryService, {type ExpenseCategory} from '@/services/expenseCategoryService';
import {authService} from '@/services/authService';
import analyticLineService from '@/services/analyticLineService';

// ==================== TYPES ====================
type TimerState = 'stopped' | 'running' | 'paused';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom';
type DatePickerMode = 'start' | 'end';

interface Task {
    id: number;
    name: string;
    timer_start?: string | false;
    timer_pause?: string | false;
    expense_ids?: any[];
    timesheet_ids?: any[];
}

interface ExpenseCardProps {
    expense: any;
    onPress: (expense: any) => void;
}

// ==================== UTILITY FUNCTIONS ====================
const stripHtmlTags = (html: string): string => {
    if (!html) return '';
    let text = html.replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    return text;
};

const formatDate = (dateString: string | number | Date): string => {
    if (!dateString) return 'Date non définie';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

const getExpenseAmount = (expense: any): string => {
    if (expense.solde_amount !== undefined && expense.solde_amount !== null) {
        return Math.abs(expense.solde_amount).toFixed(2);
    }
    if (expense.amount !== undefined && expense.amount !== null) {
        return Math.abs(expense.amount).toFixed(2);
    }
    if (expense.balance !== undefined && expense.balance !== null) {
        return Math.abs(expense.balance).toFixed(2);
    }
    if (expense.display_name) {
        const match = expense.display_name.match(/(\d+\.\d{2})/);
        return match ? match[1] : '0.00';
    }
    return '0.00';
};

const getExpenseDate = (expense: any): string => {
    return expense.date || expense.expense_date || expense.create_date || '';
};

const formatCurrency = (amount: number): string => {
    return `${amount.toFixed(2)} DH`;
};

const formatElapsedTime = (totalSeconds: number): string => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const determineTimerState = (timer_start?: string | false, timer_pause?: string | false): TimerState => {
    if (!timer_start || timer_start === false) return 'stopped';
    if (timer_start && timer_pause && timer_pause !== false) return 'paused';
    if (timer_start && (!timer_pause || timer_pause === false)) return 'running';
    return 'stopped';
};

const calculateElapsedTime = (timer_start?: string | false, timer_pause?: string | false): number => {
    if (!timer_start || timer_start === false) return 0;
    
    const startTime = new Date(timer_start).getTime();
    const now = Date.now();
    
    if (timer_pause && timer_pause !== false) {
        const pauseTime = new Date(timer_pause).getTime();
        const elapsed = Math.floor((pauseTime - startTime) / 1000);
        return Math.max(0, elapsed);
    }
    
    const elapsed = Math.floor((now - startTime) / 1000);
    return Math.max(0, elapsed);
};

// ==================== EXPENSE CARD COMPONENT ====================
const ExpenseCard = React.memo<ExpenseCardProps>(({expense, onPress}) => {
    const expenseTypeName = expense.expense_type_id?.[0]?.name || 'Type non défini';
    const expenseCategoryName = expense.expense_category_id?.[0]?.name || 'Non catégorisé';

    const getCategoryStyle = useCallback(() => {
        const categoryLower = expenseCategoryName.toLowerCase();
        if (categoryLower.includes('transport')) return { 
            color: '#f97316', 
            icon: 'car-sport-outline' as const,
            bg: '#fff7ed',
            lightBg: '#fed7aa',
            badge: '#ea580c'
        };
        if (categoryLower.includes('matériel') || categoryLower.includes('équipement')) return { 
            color: '#0ea5e9', 
            icon: 'build-outline' as const,
            bg: '#f0f9ff',
            lightBg: '#bae6fd',
            badge: '#0284c7'
        };
        if (categoryLower.includes('service')) return { 
            color: '#ec4899', 
            icon: 'cog-outline' as const,
            bg: '#fdf2f8',
            lightBg: '#fbcfe8',
            badge: '#db2777'
        };
        if (categoryLower.includes('communication')) return { 
            color: '#14b8a6', 
            icon: 'call-outline' as const,
            bg: '#f0fdfa',
            lightBg: '#99f6e4',
            badge: '#0d9488'
        };
        if (categoryLower.includes('alimenta') || categoryLower.includes('repas')) return { 
            color: '#84cc16', 
            icon: 'restaurant-outline' as const,
            bg: '#f7fee7',
            lightBg: '#d9f99d',
            badge: '#65a30d'
        };
        if (categoryLower.includes('hébergement') || categoryLower.includes('hôtel')) return { 
            color: '#a855f7', 
            icon: 'bed-outline' as const,
            bg: '#faf5ff',
            lightBg: '#e9d5ff',
            badge: '#9333ea'
        };
        return { 
            color: '#6366f1', 
            icon: 'cube-outline' as const,
            bg: '#eef2ff',
            lightBg: '#c7d2fe',
            badge: '#4f46e5'
        };
    }, [expenseCategoryName]);

    const { color, icon, bg, lightBg, badge } = getCategoryStyle();
    const amount = getExpenseAmount(expense);
    const currency = expense.currency_id?.[1] || 'MAD';
    const isLargeAmount = parseFloat(amount) >= 10000;

    return (
        <TouchableOpacity
            style={[styles.expenseCardV2, { backgroundColor: bg }]}
            activeOpacity={0.7}
            onPress={() => onPress(expense)}
        >
            <View style={[styles.expenseCardV2_Indicator, { backgroundColor: color }]} />
            <View style={[styles.expenseCardV2_Icon, { backgroundColor: lightBg }]}>
                <Ionicons name={icon} size={24} color={color} />
            </View>
            <View style={styles.expenseCardV2_Content}>
                {isLargeAmount ? (
                    <>
                        <ScrollView 
                            horizontal 
                            showsHorizontalScrollIndicator={false}
                            style={styles.expenseCardV2_NameScroll}
                        >
                            <Text style={styles.expenseCardV2_TypeName}>{expenseTypeName}</Text>
                        </ScrollView>
                        <View style={[styles.expenseCardV2_AmountBadgeFull, { backgroundColor: badge }]}>
                            <Text style={styles.expenseCardV2_Amount}>{amount}</Text>
                            <Text style={styles.expenseCardV2_Currency}>{currency}</Text>
                        </View>
                    </>
                ) : (
                    <View style={styles.expenseCardV2_Header}>
                        <ScrollView 
                            horizontal 
                            showsHorizontalScrollIndicator={false}
                            style={styles.expenseCardV2_NameScrollInline}
                        >
                            <Text style={styles.expenseCardV2_TypeName}>{expenseTypeName}</Text>
                        </ScrollView>
                        <View style={[styles.expenseCardV2_AmountBadge, { backgroundColor: badge }]}>
                            <Text style={styles.expenseCardV2_Amount}>{amount}</Text>
                            <Text style={styles.expenseCardV2_Currency}>{currency}</Text>
                        </View>
                    </View>
                )}
                {expense.description ? (
                    <Text style={styles.expenseCardV2_Description} numberOfLines={2}>
                        {stripHtmlTags(expense.description)}
                    </Text>
                ) : (
                    <Text style={styles.expenseCardV2_CategoryName} numberOfLines={1}>
                        {expenseCategoryName}
                    </Text>
                )}
                <View style={styles.expenseCardV2_Footer}>
                    <View style={styles.expenseCardV2_DateContainer}>
                        <Ionicons name="calendar-outline" size={14} color={color}/>
                        <Text style={[styles.expenseCardV2_Date, { color: color }]}>{formatDate(getExpenseDate(expense))}</Text>
                    </View>
                    <View style={[styles.expenseCardV2_IdBadge, { backgroundColor: lightBg }]}>
                        <Text style={[styles.expenseCardV2_Id, { color: badge }]}>#{expense.id}</Text>
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );
});

ExpenseCard.displayName = 'ExpenseCard';

// ==================== MAIN COMPONENT ====================
export default function TaskExpensesScreen() {
    const params = useLocalSearchParams();
    const { width } = useWindowDimensions();
    
    // ===== STATES =====
    const [task, setTask] = useState<Task | null>(null);
    const [parentProject, setParentProject] = useState<any | null>(null); // 🆕 Stocker le projet parent
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [modalVisible, setModalVisible] = useState(false);
    const [newExpenseAmount, setNewExpenseAmount] = useState('');
    const [newExpenseType, setNewExpenseType] = useState('');
    const [newExpenseDescription, setNewExpenseDescription] = useState('');
    const [showTypeDropdown, setShowTypeDropdown] = useState(false);
    const [timerState, setTimerState] = useState<TimerState>('stopped');
    const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
    const [intervalId, setIntervalId] = useState<NodeJS.Timeout | null>(null);
    const [dateFilter, setDateFilter] = useState<DateFilter>('all');
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [datePickerMode, setDatePickerMode] = useState<DatePickerMode>('start');
    const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
    const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
    const [showCustomDateModal, setShowCustomDateModal] = useState(false);
    const [expenseDetailsVisible, setExpenseDetailsVisible] = useState(false);
    const [selectedExpense, setSelectedExpense] = useState<any>(null);
    const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | null>(null);
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [loadingCategories, setLoadingCategories] = useState(true);
    
    const rotateAnim = useRef(new Animated.Value(0)).current;

    // ===== MEMOIZED VALUES =====
    const taskFinancials = useMemo(() => {
        if (!task || !task.expense_ids) return { totalExpenses: 0, totalSettlements: 0, balance: 0 };
        
        let totalExpenses = 0;
        let totalSettlements = 0;

        task.expense_ids.forEach((expense: any) => {
            const amount = Math.abs(expense.solde_amount ?? expense.amount ?? expense.balance ?? 0);
            if (expense.expense_move_type === 'replenish') {
                totalSettlements += amount;
            } else if (expense.expense_move_type === 'spent') {
                totalExpenses += amount;
            }
        });

        return { totalExpenses, totalSettlements, balance: totalSettlements - totalExpenses };
    }, [task?.expense_ids]);

    const spin = useMemo(() => rotateAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    }), [rotateAnim]);

    // ===== FILTER FUNCTIONS =====
    const filterByDate = useCallback((item: any) => {
        if (dateFilter === 'all') return true;

        const itemDate = new Date(getExpenseDate(item));
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        switch (dateFilter) {
            case 'today':
                const itemDateOnly = new Date(itemDate);
                itemDateOnly.setHours(0, 0, 0, 0);
                return itemDateOnly.getTime() === today.getTime();

            case 'week':
                const weekAgo = new Date(today);
                weekAgo.setDate(today.getDate() - 7);
                return itemDate >= weekAgo;

            case 'month':
                const monthAgo = new Date(today);
                monthAgo.setMonth(today.getMonth() - 1);
                return itemDate >= monthAgo;

            case 'custom':
                if (!customStartDate) return true;
                const itemDateOnly2 = new Date(itemDate);
                itemDateOnly2.setHours(0, 0, 0, 0);
                const startDate = new Date(customStartDate);
                startDate.setHours(0, 0, 0, 0);

                if (customEndDate) {
                    const endDate = new Date(customEndDate);
                    endDate.setHours(23, 59, 59, 999);
                    return itemDateOnly2 >= startDate && itemDateOnly2 <= endDate;
                }
                return itemDateOnly2 >= startDate;

            default:
                return true;
        }
    }, [dateFilter, customStartDate, customEndDate]);

    const filterBySearch = useCallback((expense: any) => {
        if (!searchQuery.trim()) return true;
        const query = searchQuery.toLowerCase().trim();
        const typeName = expense.expense_type_id?.[0]?.name?.toLowerCase() || '';
        const categoryName = expense.expense_category_id?.[0]?.name?.toLowerCase() || '';
        const amount = getExpenseAmount(expense);
        const description = expense.description?.toString().toLowerCase() || '';
        return (
            typeName.includes(query) ||
            categoryName.includes(query) ||
            amount.includes(query) ||
            description.includes(query) ||
            expense.id.toString().includes(query)
        );
    }, [searchQuery]);

    const filteredExpenses = useMemo(() => {
        if (!task?.expense_ids) return [];
        return task.expense_ids
            .filter(expense => expense.expense_move_type === 'spent')
            .filter(item => filterByDate(item) && filterBySearch(item));
    }, [task?.expense_ids, filterByDate, filterBySearch]);

    // ===== CALLBACKS =====
    const updateElapsedTime = useCallback(() => {
        if (task && task.timer_start) {
            const elapsed = calculateElapsedTime(task.timer_start, task.timer_pause);
            setElapsedTime(formatElapsedTime(elapsed));
        }
    }, [task]);

    const loadTaskDetails = useCallback(async (taskId: number) => {
        try {
            console.log('📋 Chargement des détails de la tâche:', taskId);
            const response = await projectCategoryService.getProjects();
            if (response.success && response.result) {
                let updatedTask: Task | null = null;
                for (const proj of response.result) {
                    if (proj.tasks) {
                        const foundTask = proj.tasks.find(t => t.id === taskId);
                        if (foundTask) {
                            updatedTask = foundTask;
                            break;
                        }
                    }
                }

                if (updatedTask) {
                    setTask(updatedTask);
                    const newTimerState = determineTimerState(updatedTask.timer_start, updatedTask.timer_pause);
                    setTimerState(newTimerState);
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
    }, []);

    const onRefresh = useCallback(async () => {
        if (!task) return;

        setRefreshing(true);
        const startTime = Date.now();

        try {
            console.log('🔄 Rafraîchissement COMPLET depuis task-expenses...');
            
            // ✅ FORCE REFRESH: Recharger TOUTES les catégories depuis l'API
            // Cela va mettre à jour toutes les pages automatiquement via les événements
            const response = await projectCategoryService.forceRefreshCategories();
            
            if (response.success && response.result) {
                // Chercher la tâche mise à jour dans les catégories
                let updatedTask: Task | null = null;
                for (const category of response.result) {
                    if (category.project_ids && Array.isArray(category.project_ids)) {
                        for (const proj of category.project_ids) {
                            if (proj.tasks && Array.isArray(proj.tasks)) {
                                const foundTask = proj.tasks.find(t => t.id === task.id);
                                if (foundTask) {
                                    updatedTask = foundTask;
                                    break;
                                }
                            }
                        }
                        if (updatedTask) break;
                    }
                }
                
                if (updatedTask) {
                    console.log('✅ Tâche mise à jour:', updatedTask.name);
                    // 🆕 Mettre à jour la tâche avec les nouvelles données
                    setTask(updatedTask);
                    const newTimerState = determineTimerState(updatedTask.timer_start, updatedTask.timer_pause);
                    setTimerState(newTimerState);
                    const newElapsed = calculateElapsedTime(updatedTask.timer_start, updatedTask.timer_pause);
                    setElapsedTime(formatElapsedTime(newElapsed));
                    
                    // 🔔 Afficher un alert pour informer l'utilisateur
                    Alert.alert(
                        '✅ Données mises à jour',
                        `La tâche "${updatedTask.name}" et ses dépenses ont été actualisées avec succès.`,
                        [{ text: 'OK' }]
                    );
                } else {
                    console.warn('⚠️ Tâche non trouvée après refresh (peut-être supprimée)');
                    // Si la tâche n'existe plus, informer l'utilisateur
                    Alert.alert(
                        'Tâche non disponible',
                        'Cette tâche n\'est plus accessible. Elle a peut-être été supprimée.',
                        [
                            { text: 'Retour', onPress: () => router.back() }
                        ]
                    );
                }
                
                console.log('✨ TOUTES les catégories ont été mises à jour (cascade)');
            } else {
                Alert.alert('Erreur', response.message || 'Impossible de rafraîchir les données');
            }
        } catch (error) {
            console.error('❌ Erreur refresh:', error);
            Alert.alert('Erreur', 'Impossible de rafraîchir les données');
        } finally {
            const elapsedTime = Date.now() - startTime;
            const remainingTime = Math.max(0, 1000 - elapsedTime);
            setTimeout(() => setRefreshing(false), remainingTime);
        }
    }, [task]);

    const handleDateChange = useCallback((event: any, selectedDate?: Date) => {
        if (Platform.OS === 'android') {
            setShowDatePicker(false);
        }

        if (selectedDate) {
            if (datePickerMode === 'start') {
                setCustomStartDate(selectedDate);
                if (customEndDate && selectedDate > customEndDate) {
                    setCustomEndDate(null);
                }
            } else {
                setCustomEndDate(selectedDate);
            }
        }
    }, [datePickerMode, customEndDate]);

    const openDatePicker = useCallback((mode: DatePickerMode) => {
        setDatePickerMode(mode);
        setShowDatePicker(true);
    }, []);

    const applyCustomPeriod = useCallback(() => {
        if (customStartDate) {
            setDateFilter('custom');
            setShowCustomDateModal(false);
        } else {
            Alert.alert('Erreur', 'Veuillez sélectionner au moins une date de début');
        }
    }, [customStartDate]);

    const resetCustomPeriod = useCallback(() => {
        setCustomStartDate(null);
        setCustomEndDate(null);
        setDateFilter('all');
        setShowCustomDateModal(false);
    }, []);

    const getCustomPeriodLabel = useCallback(() => {
        if (!customStartDate) return 'Période personnalisée';
        const formatDateLabel = (date: Date) => {
            return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
        };
        if (customEndDate) {
            return `${formatDateLabel(customStartDate)} - ${formatDateLabel(customEndDate)}`;
        }
        return `Depuis ${formatDateLabel(customStartDate)}`;
    }, [customStartDate, customEndDate]);

    const handleAddExpense = useCallback(() => {
        setModalVisible(true);
        setNewExpenseAmount('');
        setNewExpenseType('');
        setNewExpenseDescription('');
        setSelectedCategory(null);
        setShowCategoryDropdown(false);
        setShowTypeDropdown(false);
    }, []);

    const handleSaveExpense = useCallback(async () => {
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
            const currentUser = await authService.getCurrentUser();
            if (!currentUser?.id) {
                Alert.alert('Erreur', 'Impossible de récupérer l\'utilisateur connecté');
                return;
            }

            const currentDate = new Date().toISOString().split('T')[0];
            const selectedType = selectedCategory.expense_type_ids.find(t => t.id.toString() === newExpenseType);

            const expenseData: ExpenseData = {
                user_id: currentUser.id,
                expense_category_id: selectedCategory.id,
                expense_type_id: parseInt(newExpenseType),
                amount: parseFloat(newExpenseAmount),
                description: newExpenseDescription.trim() || '',
                date: currentDate
            };

            if (!task) return;
            const response = await projectCategoryService.createExpense(task.id, expenseData);

            if (response.success) {
                await projectCategoryService.forceRefreshCategories();
                await loadTaskDetails(task.id);
                setRefreshing(true);
                const startTime = Date.now();
                console.log(JSON.stringify(response, null, 2));
                const elapsedTime = Date.now() - startTime;
                const remainingTime = Math.max(0, 1000 - elapsedTime);
                setTimeout(() => setRefreshing(false), remainingTime);

                Alert.alert(
                    'Succès',
                    `Dépense ajoutée avec succès !\nType: ${selectedType?.name}\nMontant: ${newExpenseAmount} MAD`,
                    [{ text: 'OK', onPress: () => setModalVisible(false) }]
                );
                console.log('✅ Dépense créée avec succès, tâche rafraîchie');
            } else {
                Alert.alert('Erreur', response.message || 'Impossible de créer la dépense');
                console.error('❌ Erreur création dépense:', response.message);
            }
        } catch (error) {
            console.error('❌ Erreur lors de la création de la dépense:', error);
            Alert.alert('Erreur', 'Une erreur est survenue lors de la création de la dépense');
        }
    }, [selectedCategory, newExpenseType, newExpenseAmount, newExpenseDescription, task, loadTaskDetails]);

    const handleCancelExpense = useCallback(() => {
        setModalVisible(false);
        setNewExpenseAmount('');
        setNewExpenseType('');
        setNewExpenseDescription('');
        setSelectedCategory(null);
        setShowCategoryDropdown(false);
        setShowTypeDropdown(false);
    }, []);

    const handleAddAnalyticLine = useCallback(async () => {
        if (!task) return;
        
        try {
            const user = await authService.getCurrentUser();
            if (!user?.employee_id) {
                Alert.alert('Erreur', 'Employé non trouvé');
                return;
            }

            const result = await analyticLineService.create({
                task_id: task.id,
                employee_id: parseInt(user.employee_id),
                unit_amount: 1.0,
                date: new Date().toISOString().split('T')[0]
            });

            if (result.success) {
                await loadTaskDetails(task.id);
            } else {
                Alert.alert('Erreur', result.message || 'Erreur lors de la création');
            }
        } catch (error) {
            console.error('❌ Erreur création timesheet:', error);
            Alert.alert('Erreur', 'Une erreur est survenue');
        }
    }, [task, loadTaskDetails]);

    const handleExpensePress = useCallback((expense: any) => {
        console.log('💰 Dépense sélectionnée:', expense);
        setSelectedExpense(expense);
        setExpenseDetailsVisible(true);
    }, []);

    // ===== EFFECTS =====
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
            Animated.loop(
                Animated.timing(rotateAnim, {
                    toValue: 1,
                    duration: 1000,
                    useNativeDriver: true,
                })
            ).start();
        } else {
            rotateAnim.setValue(0);
        }
    }, [refreshing, rotateAnim]);

    useEffect(() => {
        if (params.task) {
            try {
                const taskData = JSON.parse(params.task as string);
                setTask(taskData);

                // 🆕 Récupérer le projet parent si disponible
                if (params.project) {
                    try {
                        const projectData = JSON.parse(params.project as string);
                        setParentProject(projectData);
                        console.log('💼 Projet parent récupéré:', projectData.name);
                    } catch (projectError) {
                        console.warn('⚠️ Erreur parsing projet parent:', projectError);
                    }
                }

                const initialTimerState = determineTimerState(taskData.timer_start, taskData.timer_pause);
                setTimerState(initialTimerState);

                const initialElapsed = calculateElapsedTime(taskData.timer_start, taskData.timer_pause);
                setElapsedTime(formatElapsedTime(initialElapsed));

                console.log('🔍 État initial du timer:', {
                    timer_start: taskData.timer_start,
                    timer_pause: taskData.timer_pause,
                    determined_state: initialTimerState,
                    elapsed_time: formatElapsedTime(initialElapsed)
                });

                setLoading(false);

                if (taskData.id) {
                    loadTaskDetails(taskData.id);
                }
            } catch (error) {
                console.error('Erreur parsing task data:', error);
                Alert.alert('Erreur', 'Impossible de charger les dépenses de la tâche');
                router.back();
            }
        }
    }, [params.task, params.project, loadTaskDetails]);

    // 🔄 S'abonner aux mises à jour WebSocket des catégories (PULL-TO-REFRESH SEULEMENT)
    useEffect(() => {
        if (!task) return;

        console.log('🔔 Abonnement aux mises à jour de catégories (task-expenses - pull-to-refresh)...');

        const unsubscribe = subscribeToCategoryUpdates(async (updatedCategories) => {
            console.log('🔄 Catégories mises à jour via pull-to-refresh (task-expenses)');
            
            // 🆕 IMPORTANT: Recharger depuis le cache pour obtenir les données filtrées correctement
            const response = await projectCategoryService.getProjectCategories();
            if (response.success && response.result) {
                // Chercher notre tâche dans les catégories mises à jour
                let updatedTask: Task | null = null;
                for (const category of response.result) {
                    if (category.project_ids && Array.isArray(category.project_ids)) {
                        for (const proj of category.project_ids) {
                            if (proj.tasks && Array.isArray(proj.tasks)) {
                                const foundTask = proj.tasks.find(t => t.id === task.id);
                                if (foundTask) {
                                    updatedTask = foundTask;
                                    break;
                                }
                            }
                        }
                        if (updatedTask) break;
                    }
                }

                if (updatedTask) {
                    console.log('🔄 Tâche mise à jour via pull-to-refresh:', updatedTask.id);
                    setTask(updatedTask);
                    const newTimerState = determineTimerState(updatedTask.timer_start, updatedTask.timer_pause);
                    setTimerState(newTimerState);
                    const newElapsed = calculateElapsedTime(updatedTask.timer_start, updatedTask.timer_pause);
                    setElapsedTime(formatElapsedTime(newElapsed));
                } else {
                    console.warn('⚠️ Tâche non trouvée dans les catégories mises à jour');
                }
            }
        });

        return () => {
            console.log('🧹 Désabonnement des mises à jour de catégories (task-expenses):', task.id);
            unsubscribe();
        };
    }, [task?.id]);

    // 🔔 S'abonner aux mises à jour WebSocket de PROJET INDIVIDUEL (REAL-TIME - SANS SCROLL)
    useEffect(() => {
        if (!task) return;

        console.log('🔔 Abonnement aux mises à jour de projets individuels (task-expenses - WebSocket)...');

        const unsubscribe = subscribeToProjectUpdates(async (updatedProject) => {
            console.log('📦 Projet mis à jour via WebSocket (task-expenses):', updatedProject.id);
            
            // ✅ Chercher notre tâche dans ce projet mis à jour
            if (updatedProject.tasks && Array.isArray(updatedProject.tasks)) {
                const updatedTask = updatedProject.tasks.find(t => t.id === task.id);
                
                if (updatedTask) {
                    console.log('✅ Tâche mise à jour via WebSocket (REAL-TIME - SANS SCROLL):', updatedTask.id);
                    // ⚠️ IMPORTANT: Mettre à jour SANS scroll
                    setTask(updatedTask);
                    const newTimerState = determineTimerState(updatedTask.timer_start, updatedTask.timer_pause);
                    setTimerState(newTimerState);
                    const newElapsed = calculateElapsedTime(updatedTask.timer_start, updatedTask.timer_pause);
                    setElapsedTime(formatElapsedTime(newElapsed));
                }
            }
        });

        return () => {
            console.log('🧹 Désabonnement des mises à jour de projets (task-expenses):', task.id);
            unsubscribe();
        };
    }, [task?.id]);

    useEffect(() => {
        if (!task) return;

        console.log('🔔 Abonnement aux suppressions de tâches...');

        const unsubscribe = subscribeToTaskDeleted(({ taskId }) => {
            if (taskId === task.id) {
                console.log('🗑️ Notre tâche supprimée via WebSocket:', taskId);
                setTask(prev => prev ? { ...prev, expense_ids: [] } : null);
            }
        });

        return () => {
            console.log('🧹 Désabonnement des suppressions de tâches');
            unsubscribe();
        };
    }, [task?.id]);

    useEffect(() => {
        if (!task) return;

        console.log('🔔 Abonnement aux suppressions de projets...');

        const unsubscribe = subscribeToProjectDeleted(async (deletedProjectId) => {
            console.log('🗑️ Projet supprimé via WebSocket:', deletedProjectId);

            try {
                const response = await projectCategoryService.getProjects();
                let taskStillExists = false;

                if (response.success && response.result) {
                    for (const proj of response.result) {
                        if (proj.tasks && proj.tasks.some(t => t.id === task.id)) {
                            taskStillExists = true;
                            break;
                        }
                    }
                }

                if (!taskStillExists) {
                    console.log('⚠️ Tâche n\'existe plus après suppression du projet');
                    setTask(prev => prev ? { ...prev, expense_ids: [] } : null);
                }
            } catch (error) {
                console.error('❌ Erreur vérification existence tâche:', error);
            }
        });

        return () => {
            console.log('🧹 Désabonnement des suppressions de projets');
            unsubscribe();
        };
    }, [task?.id]);

    useEffect(() => {
        console.log('🔔 Abonnement au vidage du cache...');

        const unsubscribe = subscribeToProjectsCleared(() => {
            console.log('🗑️ Cache vidé - Données en cache supprimées');
        });

        return () => {
            console.log('🧹 Désabonnement du vidage du cache');
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (intervalId) {
            clearInterval(intervalId);
            setIntervalId(null);
        }

        if (timerState === 'running' && task?.timer_start) {
            const newIntervalId = setInterval(updateElapsedTime, 1000);
            setIntervalId(newIntervalId);
        } else if (timerState === 'stopped') {
            setElapsedTime('00:00:00');
        } else if (timerState === 'paused' && task) {
            const pausedElapsed = calculateElapsedTime(task.timer_start, task.timer_pause);
            setElapsedTime(formatElapsedTime(pausedElapsed));
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [timerState, task, updateElapsedTime, intervalId]);

    // ===== RENDER =====
    if (loading) {
        return (
            <>
                <Stack.Screen options={{headerShown: false}}/>
                <View style={styles.loadingContainer}>
                    <StatusBar barStyle="light-content" backgroundColor="#2563eb"/>
                    <ActivityIndicator size="large" color="#3b82f6" />
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
                    <Ionicons name="alert-circle-outline" size={64} color="#ef4444" />
                    <Text style={styles.errorText}>Tâche non trouvée</Text>
                    <TouchableOpacity 
                        style={styles.backToHomeButton}
                        onPress={() => router.back()}
                    >
                        <Text style={styles.backToHomeButtonText}>Retour</Text>
                    </TouchableOpacity>
                </View>
            </>
        );
    }

    return (
        <>
            <Stack.Screen options={{headerShown: false}}/>
            <View style={styles.container}>
                <StatusBar barStyle="light-content" backgroundColor="#2563eb"/>

                {/* Refresh Overlay */}
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
                        onPress={() => {
                            // ✅ Si on a le projet parent, naviguer vers project-details
                            if (parentProject) {
                                console.log('🔙 Retour vers project-details avec projet:', parentProject.name);
                                router.replace({
                                    pathname: '/(tabs)/project-details',
                                    params: {
                                        project: JSON.stringify(parentProject),
                                        projectName: parentProject.name
                                    }
                                });
                            } else {
                                // ⚠️ Fallback: retour simple si pas de projet
                                console.log('🔙 Retour simple (pas de projet parent)');
                                router.back();
                            }
                        }}
                        accessible={true}
                        accessibilityLabel="Retour"
                        accessibilityRole="button"
                    >
                        <Ionicons name="arrow-back" size={24} color="#ffffff"/>
                    </TouchableOpacity>
                    <View style={styles.headerContent}>
                        <Text style={styles.headerTitle} numberOfLines={1}>Dépenses</Text>
                        <Text style={styles.headerSubtitle} numberOfLines={1}>{task.name}</Text>
                    </View>
                </View>

                <ScrollView
                    style={styles.scrollView}
                    contentContainerStyle={styles.scrollContent}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh}/>}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Breadcrumb */}
                    <Breadcrumb 
                        items={[
                            {
                                label: 'Projets',
                                icon: 'home-outline',
                                onPress: () => router.push('/(tabs)/')
                            },
                            {
                                label: parentProject?.name || params.projectName?.toString() || 'Projet',
                                icon: 'briefcase',
                                // Rendre cliquable seulement si on a parentProject
                                onPress: parentProject ? () => {
                                    console.log('📂 Navigation vers project-details:', parentProject.name);
                                    router.push({
                                        pathname: '/(tabs)/project-details',
                                        params: {
                                            project: JSON.stringify(parentProject),
                                            projectName: parentProject.name
                                        }
                                    });
                                } : undefined
                            },
                            {
                                label: 'Dépenses',
                                icon: 'receipt',
                                // Pas de onPress = page actuelle, non cliquable
                            }
                        ]}
                    />

                    {/* Search Filter */}
                    <View style={styles.searchContainer}>
                        <View style={styles.searchInputContainer}>
                            <Ionicons name="search" size={20} color="#9ca3af" style={styles.searchIcon} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Rechercher une dépense..."
                                placeholderTextColor="#9ca3af"
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                                autoCapitalize="none"
                                autoCorrect={false}
                                accessible={true}
                                accessibilityLabel="Champ de recherche des dépenses"
                            />
                            {searchQuery.length > 0 && (
                                <TouchableOpacity 
                                    onPress={() => setSearchQuery('')}
                                    style={styles.clearButton}
                                    accessible={true}
                                    accessibilityLabel="Effacer la recherche"
                                    accessibilityRole="button"
                                >
                                    <Ionicons name="close-circle" size={20} color="#9ca3af" />
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    {/* Date Filters */}
                    <View style={styles.dateFiltersContainer}>
                        <ScrollView 
                            horizontal 
                            showsHorizontalScrollIndicator={false} 
                            contentContainerStyle={styles.dateFiltersScroll}
                        >
                            {['all', 'today', 'week', 'month'].map((filter) => (
                                <TouchableOpacity
                                    key={filter}
                                    style={[
                                        styles.dateFilterChip, 
                                        dateFilter === filter && styles.dateFilterChipActive
                                    ]}
                                    onPress={() => setDateFilter(filter as DateFilter)}
                                    accessible={true}
                                    accessibilityLabel={`Filtrer par ${filter === 'all' ? 'tout' : filter === 'today' ? 'aujourd\'hui' : filter === 'week' ? '7 derniers jours' : '30 derniers jours'}`}
                                    accessibilityRole="button"
                                >
                                    <Text style={[
                                        styles.dateFilterText, 
                                        dateFilter === filter && styles.dateFilterTextActive
                                    ]}>
                                        {filter === 'all' ? 'Tout' : 
                                         filter === 'today' ? 'Aujourd\'hui' : 
                                         filter === 'week' ? '7 derniers jours' : 
                                         '30 derniers jours'}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                            <TouchableOpacity
                                style={[
                                    styles.dateFilterChip, 
                                    dateFilter === 'custom' && styles.dateFilterChipActive
                                ]}
                                onPress={() => setShowCustomDateModal(true)}
                                accessible={true}
                                accessibilityLabel="Période personnalisée"
                                accessibilityRole="button"
                            >
                                <Ionicons 
                                    name="calendar-outline" 
                                    size={16} 
                                    color={dateFilter === 'custom' ? '#ffffff' : '#6b7280'} 
                                    style={{ marginRight: 4 }}
                                />
                                <Text style={[
                                    styles.dateFilterText, 
                                    dateFilter === 'custom' && styles.dateFilterTextActive
                                ]}>
                                    {dateFilter === 'custom' ? getCustomPeriodLabel() : 'Période personnalisée'}
                                </Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>

                    {/* Expenses List */}
                    <View style={styles.expensesContainer}>
                        {/* Total Banner */}
                        <View style={[
                            styles.totalBanner,
                            taskFinancials.totalExpenses >= 1000000 && styles.totalBannerVertical
                        ]}>
                            <View style={styles.totalBannerLeft}>
                                <View style={styles.totalIconContainer}>
                                    <Ionicons name="wallet" size={22} color="#ffffff"/>
                                </View>
                                <View style={styles.totalBannerTextContainer}>
                                    <Text style={styles.totalBannerLabel}>Total Dépenses</Text>
                                    <Text style={styles.totalBannerSubtext}>
                                        {task.expense_ids ? task.expense_ids.filter(e => e.expense_move_type === 'spent').length : 0} dépense{task.expense_ids && task.expense_ids.filter(e => e.expense_move_type === 'spent').length > 1 ? 's' : ''}
                                    </Text>
                                </View>
                            </View>
                            <View style={[
                                styles.totalBannerRight,
                                taskFinancials.totalExpenses >= 1000000 && styles.totalBannerRightVertical
                            ]}>
                                <Text 
                                    style={[
                                        styles.totalBannerAmount,
                                        taskFinancials.totalExpenses >= 1000000 && styles.totalBannerAmountLarge
                                    ]} 
                                    numberOfLines={1} 
                                    adjustsFontSizeToFit
                                    minimumFontScale={0.6}
                                >
                                    {taskFinancials.totalExpenses.toFixed(2)}
                                </Text>
                                <Text style={styles.totalBannerCurrency}>DH</Text>
                            </View>
                        </View>

                        <View style={styles.expensesHeader}>
                            <View style={styles.expensesHeaderLeft}>
                                <Text style={styles.sectionTitle}>Liste des dépenses</Text>
                                {(searchQuery.trim() || dateFilter !== 'all') && (
                                    <Text style={styles.resultCount}>
                                        {filteredExpenses.length} résultat{filteredExpenses.length > 1 ? 's' : ''}
                                    </Text>
                                )}
                            </View>
                            <TouchableOpacity
                                style={styles.addExpenseButton}
                                onPress={handleAddExpense}
                                accessible={true}
                                accessibilityLabel="Ajouter une dépense"
                                accessibilityRole="button"
                            >
                                <Ionicons name="add" size={20} color="#3b82f6"/>
                                <Text style={styles.addExpenseText}>Ajouter</Text>
                            </TouchableOpacity>
                        </View>

                        {filteredExpenses.length > 0 ? (
                            filteredExpenses.map((expense) => (
                                <ExpenseCard 
                                    key={expense.id} 
                                    expense={expense}
                                    onPress={handleExpensePress}
                                />
                            ))
                        ) : (
                            <View style={styles.emptyContainer}>
                                <Ionicons 
                                    name={(searchQuery.trim() || dateFilter !== 'all') ? "search-outline" : "receipt-outline"} 
                                    size={64} 
                                    color="#d1d5db"
                                />
                                <Text style={styles.emptyText}>
                                    {(searchQuery.trim() || dateFilter !== 'all') 
                                        ? 'Aucune dépense trouvée' 
                                        : 'Aucune dépense pour cette tâche'
                                    }
                                </Text>
                                {!(searchQuery.trim() || dateFilter !== 'all') && (
                                    <>
                                        <Text style={styles.emptySubtext}>
                                            Ajoutez des dépenses pour suivre les coûts de cette tâche
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.addFirstExpenseButton}
                                            onPress={handleAddExpense}
                                            accessible={true}
                                            accessibilityLabel="Ajouter la première dépense"
                                            accessibilityRole="button"
                                        >
                                            <Ionicons name="add-circle-outline" size={20} color="#ffffff"/>
                                            <Text style={styles.addFirstExpenseText}>Ajouter la première dépense</Text>
                                        </TouchableOpacity>
                                    </>
                                )}
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
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalContainer}>
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>Nouvelle dépense</Text>
                                    <TouchableOpacity
                                        onPress={handleCancelExpense}
                                        style={styles.modalCloseButton}
                                        accessible={true}
                                        accessibilityLabel="Fermer"
                                        accessibilityRole="button"
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
                                    {/* Catégorie */}
                                    <View style={styles.inputGroup}>
                                        <Text style={styles.inputLabel}>Catégorie *</Text>
                                        <TouchableOpacity
                                            style={styles.selectButton}
                                            onPress={() => {
                                                setShowCategoryDropdown(!showCategoryDropdown);
                                                setShowTypeDropdown(false);
                                            }}
                                            accessible={true}
                                            accessibilityLabel="Sélectionner une catégorie"
                                            accessibilityRole="button"
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
                                            <ScrollView 
                                                style={styles.dropdown}
                                                nestedScrollEnabled={true}
                                                showsVerticalScrollIndicator={true}
                                            >
                                                {loadingCategories ? (
                                                    <View style={styles.dropdownItem}>
                                                        <ActivityIndicator size="small" color="#3b82f6" />
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
                                                                setNewExpenseType('');
                                                                setShowCategoryDropdown(false);
                                                            }}
                                                        >
                                                            <View style={{flex: 1}}>
                                                                <Text style={[
                                                                    styles.dropdownItemText,
                                                                    selectedCategory?.id === category.id && styles.dropdownItemTextSelected
                                                                ]}>
                                                                    {category.name}
                                                                </Text>
                                                            </View>
                                                            {selectedCategory?.id === category.id && (
                                                                <Ionicons name="checkmark" size={20} color="#3b82f6"/>
                                                            )}
                                                        </TouchableOpacity>
                                                    ))
                                                ) : (
                                                    <View style={styles.dropdownItem}>
                                                        <Text style={styles.dropdownItemText}>Aucune catégorie disponible</Text>
                                                    </View>
                                                )}
                                            </ScrollView>
                                        )}
                                    </View>

                                    {/* Type de dépense */}
                                    {selectedCategory && (
                                        <View style={styles.inputGroup}>
                                            <Text style={styles.inputLabel}>Type de dépense *</Text>
                                            <TouchableOpacity
                                                style={styles.selectButton}
                                                onPress={() => {
                                                    setShowTypeDropdown(!showTypeDropdown);
                                                    setShowCategoryDropdown(false);
                                                }}
                                                accessible={true}
                                                accessibilityLabel="Sélectionner un type"
                                                accessibilityRole="button"
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
                                                <ScrollView 
                                                    style={styles.dropdown}
                                                    nestedScrollEnabled={true}
                                                    showsVerticalScrollIndicator={true}
                                                >
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
                                                </ScrollView>
                                            )}
                                        </View>
                                    )}

                                    {/* Montant */}
                                    <View style={styles.inputGroup}>
                                        <Text style={styles.inputLabel}>Montant (MAD) *</Text>
                                        <View style={styles.amountInputContainer}>
                                            <TextInput
                                                style={styles.amountInput}
                                                value={newExpenseAmount}
                                                onChangeText={setNewExpenseAmount}
                                                placeholder="0.00"
                                                keyboardType="decimal-pad"
                                                returnKeyType="done"
                                                blurOnSubmit={true}
                                                accessible={true}
                                                accessibilityLabel="Montant de la dépense"
                                            />
                                            <Text style={styles.currencyLabel}>MAD</Text>
                                        </View>
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
                                            accessible={true}
                                            accessibilityLabel="Description de la dépense"
                                        />
                                    </View>
                                </ScrollView>

                                <View style={styles.modalActions}>
                                    <TouchableOpacity
                                        style={styles.cancelButton}
                                        onPress={handleCancelExpense}
                                        accessible={true}
                                        accessibilityLabel="Annuler"
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.cancelButtonText}>Annuler</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.saveButton}
                                        onPress={handleSaveExpense}
                                        accessible={true}
                                        accessibilityLabel="Ajouter la dépense"
                                        accessibilityRole="button"
                                    >
                                        <Text style={styles.saveButtonText}>Ajouter</Text>
                                    </TouchableOpacity>
                                </View>
                        </View>
                    </View>
                </Modal>

                {/* Modal période personnalisée */}
                <Modal
                    visible={showCustomDateModal}
                    transparent
                    animationType="slide"
                    onRequestClose={() => setShowCustomDateModal(false)}
                >
                    <View style={styles.dateModalOverlay}>
                        <View style={styles.dateModalContent}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>Sélectionner une période</Text>
                                <TouchableOpacity 
                                    onPress={() => setShowCustomDateModal(false)}
                                    accessible={true}
                                    accessibilityLabel="Fermer"
                                    accessibilityRole="button"
                                >
                                    <Ionicons name="close" size={24} color="#6b7280"/>
                                </TouchableOpacity>
                            </View>

                            <View style={styles.dateSelectionContainer}>
                                <TouchableOpacity
                                    style={styles.dateButton}
                                    onPress={() => openDatePicker('start')}
                                    accessible={true}
                                    accessibilityLabel="Sélectionner la date de début"
                                    accessibilityRole="button"
                                >
                                    <View style={styles.dateButtonContent}>
                                        <Ionicons name="calendar-outline" size={20} color="#3b82f6"/>
                                        <View style={styles.dateButtonText}>
                                            <Text style={styles.dateButtonLabel}>Date de début</Text>
                                            <Text style={styles.dateButtonValue}>
                                                {customStartDate
                                                    ? customStartDate.toLocaleDateString('fr-FR', {
                                                        day: '2-digit',
                                                        month: 'long',
                                                        year: 'numeric'
                                                    })
                                                    : 'Sélectionner'}
                                            </Text>
                                        </View>
                                    </View>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={styles.dateButton}
                                    onPress={() => openDatePicker('end')}
                                    disabled={!customStartDate}
                                    accessible={true}
                                    accessibilityLabel="Sélectionner la date de fin"
                                    accessibilityRole="button"
                                >
                                    <View
                                        style={[styles.dateButtonContent, !customStartDate && styles.dateButtonDisabled]}>
                                        <Ionicons
                                            name="calendar-outline"
                                            size={20}
                                            color={customStartDate ? '#3b82f6' : '#d1d5db'}
                                        />
                                        <View style={styles.dateButtonText}>
                                            <Text
                                                style={[styles.dateButtonLabel, !customStartDate && styles.dateButtonLabelDisabled]}>
                                                Date de fin (optionnelle)
                                            </Text>
                                            <Text
                                                style={[styles.dateButtonValue, !customStartDate && styles.dateButtonValueDisabled]}>
                                                {customEndDate
                                                    ? customEndDate.toLocaleDateString('fr-FR', {
                                                        day: '2-digit',
                                                        month: 'long',
                                                        year: 'numeric'
                                                    })
                                                    : 'Sélectionner'}
                                            </Text>
                                        </View>
                                    </View>
                                </TouchableOpacity>

                                {showDatePicker && Platform.OS === 'ios' && (
                                    <View style={styles.iosDatePickerContainer}>
                                        <DateTimePicker
                                            value={datePickerMode === 'start' ? (customStartDate || new Date()) : (customEndDate || new Date())}
                                            mode="date"
                                            display="spinner"
                                            onChange={handleDateChange}
                                            maximumDate={new Date()}
                                            minimumDate={datePickerMode === 'end' && customStartDate ? customStartDate : undefined}
                                            style={{backgroundColor: 'white'}}
                                        />
                                    </View>
                                )}
                            </View>

                            <View style={styles.modalActions}>
                                <TouchableOpacity
                                    style={[styles.modalButton, styles.modalButtonSecondary]}
                                    onPress={resetCustomPeriod}
                                    accessible={true}
                                    accessibilityLabel="Réinitialiser"
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.modalButtonTextSecondary}>Réinitialiser</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.modalButton, styles.modalButtonPrimary]}
                                    onPress={applyCustomPeriod}
                                    accessible={true}
                                    accessibilityLabel="Appliquer"
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.modalButtonTextPrimary}>Appliquer</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* DateTimePicker pour Android */}
                {showDatePicker && Platform.OS === 'android' && (
                    <DateTimePicker
                        value={datePickerMode === 'start' ? (customStartDate || new Date()) : (customEndDate || new Date())}
                        mode="date"
                        display="default"
                        onChange={handleDateChange}
                        maximumDate={new Date()}
                        minimumDate={datePickerMode === 'end' && customStartDate ? customStartDate : undefined}
                    />
                )}

                {/* Modal détails dépense */}
                <Modal
                    animationType="fade"
                    transparent={true}
                    visible={expenseDetailsVisible}
                    onRequestClose={() => setExpenseDetailsVisible(false)}
                >
                    <View style={styles.detailsModalOverlay}>
                        <View style={styles.detailsModalContainer}>
                            <View style={styles.modalHeader}>
                                <Text style={styles.modalTitle}>💰 Détails de la dépense</Text>
                                <TouchableOpacity
                                    onPress={() => setExpenseDetailsVisible(false)}
                                    style={styles.modalCloseButton}
                                    accessible={true}
                                    accessibilityLabel="Fermer"
                                    accessibilityRole="button"
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
                                        <View style={styles.detailsIdBadge}>
                                            <Ionicons name="receipt" size={20} color="#3b82f6"/>
                                            <Text style={styles.detailsIdText}>Dépense #{selectedExpense.id}</Text>
                                        </View>

                                        <View style={styles.detailsAmountSection}>
                                            <Text style={styles.detailsAmountLabel}>Montant</Text>
                                            <View style={styles.detailsAmountBox}>
                                                <Text style={styles.detailsAmountValue}>
                                                    {getExpenseAmount(selectedExpense)}
                                                </Text>
                                                <Text style={styles.detailsAmountCurrency}>
                                                    {selectedExpense.currency_id?.[1] || 'MAD'}
                                                </Text>
                                            </View>
                                        </View>

                                        <View style={styles.detailsInfoRow}>
                                            <View style={styles.detailsInfoLabel}>
                                                <Ionicons name="folder" size={18} color="#8b5cf6"/>
                                                <Text style={styles.detailsInfoLabelText}>Catégorie</Text>
                                            </View>
                                            <Text style={styles.detailsInfoValue}>
                                                {selectedExpense.expense_category_id?.[0]?.name || 'Non catégorisé'}
                                            </Text>
                                        </View>

                                        <View style={styles.detailsInfoRow}>
                                            <View style={styles.detailsInfoLabel}>
                                                <Ionicons name="pricetag" size={18} color="#10b981"/>
                                                <Text style={styles.detailsInfoLabelText}>Type</Text>
                                            </View>
                                            <Text style={styles.detailsInfoValue}>
                                                {selectedExpense.expense_type_id?.[0]?.name || 'Type non défini'}
                                            </Text>
                                        </View>

                                        {selectedExpense.description && selectedExpense.description.trim() !== '' && (
                                            <View style={styles.detailsDescriptionSection}>
                                                <View style={styles.detailsInfoLabel}>
                                                    <Ionicons name="document-text" size={18} color="#f59e0b"/>
                                                    <Text style={styles.detailsInfoLabelText}>Description</Text>
                                                </View>
                                                <View style={styles.detailsDescriptionBox}>
                                                    <RenderHtml
                                                        contentWidth={width - 80}
                                                        source={{ html: selectedExpense.description }}
                                                        tagsStyles={{
                                                            body: {
                                                                color: '#374151',
                                                                fontSize: 14,
                                                                lineHeight: 20,
                                                            },
                                                            p: { margin: 0, marginBottom: 8 },
                                                            strong: { fontWeight: '600' },
                                                            em: { fontStyle: 'italic' },
                                                            ul: { marginLeft: 16 },
                                                            ol: { marginLeft: 16 },
                                                            li: { marginBottom: 4 },
                                                        }}
                                                    />
                                                </View>
                                            </View>
                                        )}

                                        <View style={styles.detailsInfoRow}>
                                            <View style={styles.detailsInfoLabel}>
                                                <Ionicons name="calendar" size={18} color="#3b82f6"/>
                                                <Text style={styles.detailsInfoLabelText}>Date</Text>
                                            </View>
                                            <Text style={styles.detailsInfoValue}>
                                                {formatDate(getExpenseDate(selectedExpense))}
                                            </Text>
                                        </View>

                                        {selectedExpense.project_id?.length > 1 && (
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

                                        {selectedExpense.task_id?.length > 1 && (
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


                                    </View>
                                )}
                            </ScrollView>

                            <View style={styles.modalActions}>
                                <TouchableOpacity
                                    style={[styles.saveButton, {flex: 1}]}
                                    onPress={() => setExpenseDetailsVisible(false)}
                                    accessible={true}
                                    accessibilityLabel="Fermer"
                                    accessibilityRole="button"
                                >
                                    <Text style={styles.saveButtonText}>Fermer</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>

                {/* Fixed Bottom Button - Pointer */}
                <View style={styles.fixedBottomContainer}>
                    <TouchableOpacity
                        style={[
                            styles.fixedPointerButton,
                            task.timesheet_ids?.length > 0 && styles.fixedPointerButtonDisabled
                        ]}
                        onPress={handleAddAnalyticLine}
                        activeOpacity={task.timesheet_ids?.length > 0 ? 1 : 0.7}
                        disabled={task.timesheet_ids?.length > 0}
                        accessible={true}
                        accessibilityLabel={task.timesheet_ids?.length > 0 ? "Déjà pointé" : "Pointer la tâche"}
                        accessibilityRole="button"
                    >
                        <View style={styles.fixedPointerButtonContent}>
                            <View style={[
                                styles.fixedPointerIconContainer,
                                task.timesheet_ids?.length > 0 && styles.fixedPointerIconContainerDisabled
                            ]}>
                                <Ionicons 
                                    name={task.timesheet_ids?.length > 0 ? "checkmark-circle" : "timer"} 
                                    size={24} 
                                    color={task.timesheet_ids?.length > 0 ? "#9ca3af" : "#ffffff"}
                                />
                            </View>
                            <View style={styles.fixedPointerTextContainer}>
                                <Text style={[
                                    styles.fixedPointerButtonText,
                                    task.timesheet_ids?.length > 0 && styles.fixedPointerButtonTextDisabled
                                ]}>
                                    {task.timesheet_ids?.length > 0 ? "Déjà pointé" : "Pointer"}
                                </Text>
                                <Text style={[
                                    styles.fixedPointerButtonSubtext,
                                    task.timesheet_ids?.length > 0 && styles.fixedPointerButtonSubtextDisabled
                                ]}>
                                    {task.timesheet_ids?.length > 0
                                        ? "Tâche déjà pointée"
                                        : "Enregistrer le temps passé"
                                    }
                                </Text>
                            </View>
                        </View>
                        <Ionicons 
                            name={task.timesheet_ids?.length > 0 ? "lock-closed" : "chevron-forward"} 
                            size={22} 
                            color={task.timesheet_ids?.length > 0 ? "#9ca3af" : "#ffffff"}
                        />
                    </TouchableOpacity>
                </View>
            </View>
        </>
    );
}

// ==================== STYLES ====================
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8fafc',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: '#6b7280',
        fontWeight: '500',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f8fafc',
        padding: 32,
    },
    errorText: {
        marginTop: 16,
        fontSize: 18,
        color: '#ef4444',
        fontWeight: '600',
        textAlign: 'center',
    },
    backToHomeButton: {
        marginTop: 24,
        paddingHorizontal: 24,
        paddingVertical: 12,
        backgroundColor: '#3b82f6',
        borderRadius: 12,
    },
    backToHomeButtonText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
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
        shadowOffset: { width: 0, height: 4 },
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
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingTop: 140,
        paddingBottom: 120,
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
    taskInfoCardV2: {
        backgroundColor: '#ffffff',
        marginHorizontal: 16,
        marginTop: 16,
        borderRadius: 20,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    taskInfoCardV2Header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    taskInfoCardV2IconWrapper: {
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
    },
    taskInfoCardV2Icon: {
        width: 52,
        height: 52,
        borderRadius: 14,
        backgroundColor: '#eff6ff',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#dbeafe',
    },
    taskInfoCardV2Title: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 6,
        lineHeight: 24,
    },
    taskInfoCardV2SubtitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    taskInfoCardV2Subtitle: {
        fontSize: 14,
        color: '#6b7280',
        fontWeight: '500',
    },
    // Financial Simple Styles
    taskInfoCardV2FinancialSimple: {
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    financialSimpleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    financialSimpleLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    financialSimpleLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
    },
    financialSimpleRight: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    financialSimpleAmount: {
        fontSize: 22,
        fontWeight: '700',
        color: '#111827',
    },
    financialSimpleSubtext: {
        fontSize: 13,
        color: '#9ca3af',
        fontWeight: '500',
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingVertical: 16,
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        paddingHorizontal: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        paddingVertical: 12,
        fontSize: 15,
        color: '#111827',
    },
    clearButton: {
        padding: 4,
    },
    dateFiltersContainer: {
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
        paddingVertical: 12,
    },
    dateFiltersScroll: {
        paddingHorizontal: 16,
        gap: 8,
    },
    dateFilterChip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        backgroundColor: '#ffffff',
        marginRight: 8,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        minHeight: 40,
    },
    dateFilterChipActive: {
        backgroundColor: '#3b82f6',
        borderColor: '#3b82f6',
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    dateFilterText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#6b7280',
    },
    dateFilterTextActive: {
        color: '#ffffff',
        fontWeight: '600',
    },
    expensesContainer: {
        paddingHorizontal: 16,
        paddingTop: 20,
    },
    totalBanner: {
        backgroundColor: '#3b82f6',
        borderRadius: 16,
        padding: 18,
        marginBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
        minHeight: 80,
    },
    totalBannerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        flex: 1,
        marginRight: 12,
    },
    totalIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    totalBannerTextContainer: {
        flex: 1,
    },
    totalBannerLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#ffffff',
        marginBottom: 2,
    },
    totalBannerSubtext: {
        fontSize: 12,
        fontWeight: '500',
        color: 'rgba(255, 255, 255, 0.8)',
    },
    totalBannerRight: {
        alignItems: 'flex-end',
        flexShrink: 0,
        maxWidth: '45%',
    },
    totalBannerAmount: {
        fontSize: 26,
        fontWeight: '800',
        color: '#ffffff',
        letterSpacing: -0.5,
        textAlign: 'right',
    },
    totalBannerCurrency: {
        fontSize: 14,
        fontWeight: '700',
        color: 'rgba(255, 255, 255, 0.9)',
        marginTop: 2,
    },
    totalBannerVertical: {
        flexDirection: 'column',
        alignItems: 'stretch',
        minHeight: 100,
    },
    totalBannerRightVertical: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.2)',
        alignItems: 'center',
        maxWidth: '100%',
    },
    totalBannerAmountLarge: {
        fontSize: 32,
        textAlign: 'center',
    },
    expensesHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    expensesHeaderLeft: {
        flex: 1,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 4,
    },
    resultCount: {
        fontSize: 13,
        color: '#6b7280',
        fontWeight: '500',
    },
    addExpenseButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#3b82f6',
    },
    addExpenseText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#3b82f6',
        marginLeft: 6,
    },
    expenseCardV2: {
        borderRadius: 16,
        marginBottom: 12,
        flexDirection: 'row',
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.05)',
    },
    expenseCardV2_Indicator: {
        width: 5,
    },
    expenseCardV2_Icon: {
        width: 56,
        alignItems: 'center',
        justifyContent: 'center',
        borderRightWidth: 1,
        borderRightColor: 'rgba(0, 0, 0, 0.05)',
    },
    expenseCardV2_Content: {
        flex: 1,
        paddingVertical: 14,
        paddingRight: 16,
        paddingLeft: 12,
    },
    expenseCardV2_Header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    expenseCardV2_NameScroll: {
        marginBottom: 4,
        maxHeight: 24,
    },
    expenseCardV2_NameScrollInline: {
        flex: 1,
        marginRight: 12,
        maxHeight: 24,
    },
    expenseCardV2_TypeName: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111827',
    },
    expenseCardV2_AmountBadge: {
        flexDirection: 'row',
        alignItems: 'baseline',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        gap: 4,
    },
    expenseCardV2_AmountBadgeFull: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 10,
        gap: 6,
        marginTop: 8,
        marginBottom: 8,
    },
    expenseCardV2_Amount: {
        fontSize: 15,
        fontWeight: '700',
        color: '#ffffff',
    },
    expenseCardV2_Currency: {
        fontSize: 12,
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.9)',
    },
    expenseCardV2_Description: {
        fontSize: 14,
        color: '#4b5563',
        lineHeight: 20,
        marginBottom: 8,
    },
    expenseCardV2_CategoryName: {
        fontSize: 13,
        color: '#6b7280',
        marginBottom: 8,
        fontWeight: '500',
    },
    expenseCardV2_Footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    expenseCardV2_DateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    expenseCardV2_Date: {
        fontSize: 13,
        fontWeight: '600',
    },
    expenseCardV2_IdBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    expenseCardV2_Id: {
        fontSize: 12,
        fontWeight: '700',
    },
    emptyContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 64,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6b7280',
        marginTop: 16,
        textAlign: 'center',
    },
    emptySubtext: {
        fontSize: 14,
        color: '#9ca3af',
        marginTop: 8,
        textAlign: 'center',
        paddingHorizontal: 32,
        lineHeight: 20,
    },
    addFirstExpenseButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#3b82f6',
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 12,
        marginTop: 24,
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    addFirstExpenseText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#ffffff',
        marginLeft: 8,
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    modalPressable: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
        paddingHorizontal: 20,
    },
    modalContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        width: '100%',
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
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
    },
    modalCloseButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalScrollView: {
        flexGrow: 0,
        maxHeight: 450,
    },
    modalScrollContent: {
        paddingHorizontal: 24,
        paddingVertical: 20,
    },
    inputGroup: {
        marginBottom: 20,
    },
    inputLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    selectButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        minHeight: 52,
    },
    selectContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 10,
    },
    selectText: {
        fontSize: 15,
        color: '#111827',
        flex: 1,
    },
    dropdown: {
        marginTop: 8,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        maxHeight: 450,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
    },
    dropdownItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    dropdownItemSelected: {
        backgroundColor: '#eff6ff',
    },
    dropdownItemText: {
        fontSize: 15,
        color: '#111827',
        fontWeight: '500',
        flex: 1,
        paddingRight: 12,
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
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        paddingHorizontal: 14,
        minHeight: 52,
    },
    amountInput: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
        paddingVertical: 12,
    },
    currencyLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6b7280',
        marginLeft: 8,
    },
    descriptionInput: {
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        padding: 14,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        fontSize: 15,
        color: '#111827',
        minHeight: 100,
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 24,
        paddingVertical: 20,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    cancelButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6b7280',
    },
    saveButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        backgroundColor: '#3b82f6',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#3b82f6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#ffffff',
    },
    dateModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    dateModalContent: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        maxHeight: '80%',
    },
    dateSelectionContainer: {
        marginBottom: 24,
    },
    dateButton: {
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    dateButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dateButtonDisabled: {
        opacity: 0.5,
    },
    dateButtonText: {
        marginLeft: 12,
        flex: 1,
    },
    dateButtonLabel: {
        fontSize: 12,
        color: '#6b7280',
        marginBottom: 4,
    },
    dateButtonLabelDisabled: {
        color: '#d1d5db',
    },
    dateButtonValue: {
        fontSize: 16,
        fontWeight: '600',
        color: '#111827',
    },
    dateButtonValueDisabled: {
        color: '#d1d5db',
    },
    modalButton: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
    },
    modalButtonPrimary: {
        backgroundColor: '#3b82f6',
    },
    modalButtonSecondary: {
        backgroundColor: '#f3f4f6',
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    modalButtonTextPrimary: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '600',
    },
    modalButtonTextSecondary: {
        color: '#6b7280',
        fontSize: 16,
        fontWeight: '600',
    },
    iosDatePickerContainer: {
        backgroundColor: '#ffffff',
        marginTop: 16,
        borderRadius: 12,
        overflow: 'hidden',
    },
    detailsModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    detailsModalContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        width: '90%',
        maxHeight: '90%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 10,
    },
    detailsScrollView: {
        flexGrow: 0,
        maxHeight: 600,
    },
    detailsScrollContent: {
        paddingHorizontal: 20,
        paddingVertical: 10,
        paddingBottom: 20,
    },
    expenseDetailsContainer: {
        gap: 12,
    },
    detailsIdBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#eff6ff',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        alignSelf: 'flex-start',
        gap: 6,
    },
    detailsIdText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#3b82f6',
    },
    detailsAmountSection: {
        backgroundColor: '#f0fdf4',
        borderRadius: 12,
        padding: 16,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#bbf7d0',
    },
    detailsAmountLabel: {
        fontSize: 13,
        color: '#166534',
        fontWeight: '600',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    detailsAmountBox: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    detailsAmountValue: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#15803d',
    },
    detailsAmountCurrency: {
        fontSize: 20,
        fontWeight: '600',
        color: '#16a34a',
    },
    detailsInfoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#f3f4f6',
    },
    detailsInfoLabel: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginRight: 16,
    },
    detailsInfoLabelText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
    },
    detailsInfoValue: {
        fontSize: 14,
        color: '#111827',
        fontWeight: '500',
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
    detailsDisplayNameSection: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#f9fafb',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    detailsDisplayNameLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#6b7280',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    detailsDisplayNameBox: {
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    detailsDisplayNameText: {
        fontSize: 13,
        color: '#374151',
        lineHeight: 20,
        fontFamily: 'monospace',
    },
    // Fixed Bottom Button Styles
    fixedBottomContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 10,
    },
    fixedPointerButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#10b981',
        borderRadius: 16,
        padding: 16,
        shadowColor: '#10b981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 8,
    },
    fixedPointerButtonDisabled: {
        backgroundColor: '#f3f4f6',
        shadowColor: '#000',
        shadowOpacity: 0.1,
    },
    fixedPointerButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    fixedPointerIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 14,
    },
    fixedPointerIconContainerDisabled: {
        backgroundColor: 'rgba(156, 163, 175, 0.2)',
    },
    fixedPointerTextContainer: {
        flex: 1,
    },
    fixedPointerButtonText: {
        fontSize: 17,
        fontWeight: '700',
        color: '#ffffff',
        marginBottom: 2,
    },
    fixedPointerButtonTextDisabled: {
        color: '#6b7280',
    },
    fixedPointerButtonSubtext: {
        fontSize: 13,
        color: 'rgba(255, 255, 255, 0.9)',
        fontWeight: '500',
    },
    fixedPointerButtonSubtextDisabled: {
        color: '#9ca3af',
    },
});
