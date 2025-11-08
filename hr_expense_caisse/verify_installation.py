#!/usr/bin/env python3
"""
Script de vérification de l'installation de la synchronisation des filtres
Module: hr_expense_caisse
"""

import os
import sys

def check_file_exists(filepath, description):
    """Vérifie si un fichier existe."""
    if os.path.exists(filepath):
        print(f"✅ {description}: OK")
        return True
    else:
        print(f"❌ {description}: MANQUANT")
        return False

def check_file_contains(filepath, search_string, description):
    """Vérifie si un fichier contient une chaîne spécifique."""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            if search_string in content:
                print(f"✅ {description}: OK")
                return True
            else:
                print(f"⚠️  {description}: NON TROUVÉ")
                return False
    except Exception as e:
        print(f"❌ {description}: ERREUR - {e}")
        return False

def main():
    print("=" * 70)
    print("🔍 VÉRIFICATION DE LA SYNCHRONISATION DES FILTRES")
    print("=" * 70)
    print()
    
    # Chemin de base du module
    base_path = os.path.dirname(os.path.abspath(__file__))
    
    all_checks_passed = True
    
    # 1. Vérifier les fichiers principaux
    print("📁 1. FICHIERS PRINCIPAUX")
    print("-" * 70)
    
    files_to_check = [
        ("static/src/components/expense_dashboard.js", "Dashboard JS"),
        ("static/src/components/expense_dashboard.xml", "Dashboard XML"),
        ("static/src/views/list.js", "List Controller JS"),
        ("static/src/views/list.xml", "List View XML"),
    ]
    
    for filepath, description in files_to_check:
        full_path = os.path.join(base_path, filepath)
        if not check_file_exists(full_path, description):
            all_checks_passed = False
    
    print()
    
    # 2. Vérifier les fichiers de documentation
    print("📚 2. DOCUMENTATION")
    print("-" * 70)
    
    doc_files = [
        ("FILTER_SYNC_README.md", "README Synchronisation"),
        ("TEST_GUIDE.md", "Guide de Test"),
        ("CHANGELOG.md", "Changelog"),
    ]
    
    for filepath, description in doc_files:
        full_path = os.path.join(base_path, filepath)
        if not check_file_exists(full_path, description):
            all_checks_passed = False
    
    print()
    
    # 3. Vérifier les modifications dans expense_dashboard.js
    print("🔧 3. MODIFICATIONS DASHBOARD")
    print("-" * 70)
    
    dashboard_js = os.path.join(base_path, "static/src/components/expense_dashboard.js")
    
    dashboard_checks = [
        ("console.error('❌ Erreur changement filtre caisse:", "Logs Caisse"),
        ("console.error('❌ Erreur changement filtre employé:", "Logs Employé"),
        ("console.error('❌ Erreur changement filtre date:", "Logs Date"),
        ("console.error('❌ Erreur changement filtre mois:", "Logs Mois"),
        ("emitFilterChangeEvent()", "Émission événements"),
        ("applySearchFilters", "Réception événements liste"),
    ]
    
    for search_string, description in dashboard_checks:
        if not check_file_contains(dashboard_js, search_string, description):
            all_checks_passed = False
    
    print()
    
    # 4. Vérifier les modifications dans list.js
    print("🔧 4. MODIFICATIONS CONTROLLER LISTE")
    print("-" * 70)
    
    list_js = os.path.join(base_path, "static/src/views/list.js")
    
    list_checks = [
        ("console.log('🔄 SYNC: Application filtres dashboard vers liste:", "Logs SYNC"),
        ("this.model.root.load", "Rechargement modèle"),
        ("this.render()", "Forcer le rendu"),
        ("console.log('✅ SYNC: Modèle rechargé avec succès')", "Logs succès"),
        ("applyDashboardFiltersToSearch", "Application filtres dashboard"),
        ("handleSearchFilterChange", "Détection changement search"),
    ]
    
    for search_string, description in list_checks:
        if not check_file_contains(list_js, search_string, description):
            all_checks_passed = False
    
    print()
    
    # 5. Vérifier les événements
    print("📡 5. ÉVÉNEMENTS CUSTOM")
    print("-" * 70)
    
    event_checks = [
        (dashboard_js, "dashboard-filter-changed", "Événement Dashboard→Liste"),
        (dashboard_js, "search-filter-changed", "Événement Liste→Dashboard (réception)"),
        (list_js, "search-filter-changed", "Événement Liste→Dashboard (émission)"),
        (list_js, "dashboard-filter-changed", "Événement Dashboard→Liste (réception)"),
    ]
    
    for filepath, event_name, description in event_checks:
        if not check_file_contains(filepath, event_name, description):
            all_checks_passed = False
    
    print()
    
    # 6. Résumé
    print("=" * 70)
    if all_checks_passed:
        print("✅ TOUTES LES VÉRIFICATIONS SONT PASSÉES")
        print()
        print("📋 Prochaines étapes:")
        print("   1. Redémarrer le serveur Odoo")
        print("   2. Mettre à jour le module hr_expense_caisse")
        print("   3. Suivre le guide de test: TEST_GUIDE.md")
        print("   4. Consulter la documentation: FILTER_SYNC_README.md")
    else:
        print("⚠️  CERTAINES VÉRIFICATIONS ONT ÉCHOUÉ")
        print()
        print("🔧 Actions recommandées:")
        print("   1. Vérifier que tous les fichiers sont présents")
        print("   2. Vérifier que les modifications ont été appliquées")
        print("   3. Relire le CHANGELOG.md pour voir ce qui a changé")
    print("=" * 70)
    
    return 0 if all_checks_passed else 1

if __name__ == "__main__":
    sys.exit(main())
