# -*- coding: utf-8 -*-
import logging

_logger = logging.getLogger(__name__)

def migrate(cr, version):
    """
    Migration de project_id vers employee_id dans hr_expense_account
    """
    _logger.info("=== Début de la migration project_id -> employee_id ===")
    
    # 1. Ajouter la colonne employee_id si elle n'existe pas
    cr.execute("""
        ALTER TABLE hr_expense_account 
        ADD COLUMN IF NOT EXISTS employee_id INTEGER
    """)
    
    # 2. Créer des employés pour chaque projet qui a une caisse
    cr.execute("""
        SELECT DISTINCT 
            hea.id as caisse_id,
            hea.name as caisse_name,
            hea.project_id,
            pp.name as project_name,
            pp.user_id
        FROM hr_expense_account hea
        LEFT JOIN project_project pp ON pp.id = hea.project_id
        WHERE hea.project_id IS NOT NULL
    """)
    
    caisses_with_projects = cr.fetchall()
    _logger.info(f"Nombre de caisses liées à des projets: {len(caisses_with_projects)}")
    
    for caisse_id, caisse_name, project_id, project_name, user_id in caisses_with_projects:
        # Vérifier si un employé existe déjà pour cet utilisateur
        cr.execute("""
            SELECT id FROM hr_employee 
            WHERE user_id = %s 
            LIMIT 1
        """, (user_id,))
        
        employee = cr.fetchone()
        
        if employee:
            employee_id = employee[0]
            _logger.info(f"Employé existant trouvé (ID: {employee_id}) pour user_id={user_id}")
        else:
            # Créer un nouvel employé
            cr.execute("""
                INSERT INTO hr_employee (name, user_id, active, company_id, create_uid, write_uid, create_date, write_date)
                SELECT 
                    CONCAT('Employé - ', ru.name),
                    %s,
                    TRUE,
                    rc.id,
                    1,
                    1,
                    NOW(),
                    NOW()
                FROM res_users ru
                CROSS JOIN res_company rc
                WHERE ru.id = %s
                LIMIT 1
                RETURNING id
            """, (user_id, user_id))
            
            result = cr.fetchone()
            if result:
                employee_id = result[0]
                _logger.info(f"Nouvel employé créé (ID: {employee_id}) pour user_id={user_id}")
            else:
                _logger.warning(f"Impossible de créer l'employé pour user_id={user_id}")
                continue
        
        # Mettre à jour la caisse avec l'employee_id
        cr.execute("""
            UPDATE hr_expense_account 
            SET employee_id = %s
            WHERE id = %s
        """, (employee_id, caisse_id))
        
        _logger.info(f"Caisse {caisse_name} (ID: {caisse_id}) liée à l'employé (ID: {employee_id})")
    
    # 3. Supprimer la contrainte unique sur project_id si elle existe
    cr.execute("""
        ALTER TABLE hr_expense_account 
        DROP CONSTRAINT IF EXISTS hr_expense_account_unique_project_id
    """)
    
    # 4. Supprimer la colonne project_id (optionnel, vous pouvez la garder temporairement)
    # ATTENTION: Décommenter seulement si vous êtes sûr de ne plus en avoir besoin
    # cr.execute("""
    #     ALTER TABLE hr_expense_account 
    #     DROP COLUMN IF EXISTS project_id
    # """)
    
    _logger.info("=== Migration terminée avec succès ===")
