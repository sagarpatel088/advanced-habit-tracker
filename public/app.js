const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:5000/api' : '/api';
let selectedHabitId = null; // सिलेक्टेड आदत की ID

// लोकल स्टोरेज से सुरक्षित टोकन (Digital Key) प्राप्त करें
const getToken = () => localStorage.getItem('token');

// वर्तमान महीना और साल सेट करें
const d = new Date();
document.getElementById('month-select').value = d.getMonth() + 1;
document.getElementById('year-select').value = d.getFullYear();

// जब महीना या साल बदला जाए
document.getElementById('month-select').addEventListener('change', loadTracker);
document.getElementById('year-select').addEventListener('change', loadTracker);

// पहली बार लोड करें
document.addEventListener('DOMContentLoaded', loadTracker);

async function loadTracker() {
    selectedHabitId = null; // रीसेट करें
    toggleActionButtons(false); // बटन्स डिसेबल करें

    const month = parseInt(document.getElementById('month-select').value);
    const year = parseInt(document.getElementById('year-select').value);
    const daysInMonth = new Date(year, month, 0).getDate();

    // 1. टेबल का हेडर तैयार करें
    const headersRow = document.getElementById('table-headers');
    let headersHTML = `<th class="p-4 font-bold text-slate-100 min-w-[200px]">आदतें (Habits)</th>`;
    for (let day = 1; day <= daysInMonth; day++) {
        headersHTML += `<th class="p-2 text-center text-xs font-bold w-10">${day}</th>`;
    }
    headersRow.innerHTML = headersHTML;

    // 2. डेटाबेस से आदतें लोड करें
    try {
        const response = await fetch(`${API_URL}/habits-with-logs?month=${month}&year=${year}`, {
            headers: {
                'Authorization': `Bearer ${getToken()}`
            }
        });
        const habits = await response.json();

        const tableBody = document.getElementById('table-body');
        tableBody.innerHTML = '';

        if (habits.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="${daysInMonth + 1}" class="text-center p-8 text-slate-500">
                        कोई आदत नहीं मिली। 'Add' बटन से पहली आदत जोड़ें!
                    </td>
                </tr>
            `;
            return;
        }

        habits.forEach((habit, index) => {
            const row = document.createElement('tr');
            row.className = 'habit-row cursor-pointer hover:bg-slate-700/20 transition';
            row.setAttribute('data-id', habit.id);

            // आदत का नाम
            let rowHTML = `
                <td class="p-4 font-semibold text-slate-200">
                    <div class="flex items-center gap-2">
                        <span class="text-xs text-slate-500">${index + 1}.</span>
                        <span class="habit-name-text">${habit.name}</span>
                    </div>
                </td>
            `;

            // हर दिन के लिए चेकबॉक्स
            for (let day = 1; day <= daysInMonth; day++) {
                const isCompleted = habit.completed_days ? habit.completed_days.includes(day) : false;
                rowHTML += `
                    <td class="p-2 text-center">
                        <input type="checkbox" 
                            data-habit-id="${habit.id}" 
                            data-day="${day}"
                            ${isCompleted ? 'checked' : ''} 
                            class="habit-checkbox w-5 h-5 rounded cursor-pointer accent-emerald-500 bg-slate-900 border-slate-700"
                        >
                    </td>
                `;
            }

            row.innerHTML = rowHTML;
            tableBody.appendChild(row);
        });

        // इवेंट्स जोड़ें
        addCheckboxListeners();
        addRowSelectionListeners();

    } catch (error) {
        console.error('डेटा लोड करने में समस्या:', error);
    }
}

// पंक्ति (Row) सिलेक्ट करने का लॉजिक
function addRowSelectionListeners() {
    const rows = document.querySelectorAll('.habit-row');
    rows.forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.classList.contains('habit-checkbox')) return;

            const habitId = row.getAttribute('data-id');

            if (selectedHabitId === habitId) {
                selectedHabitId = null;
                row.classList.remove('selected-row');
                toggleActionButtons(false);
            } else {
                rows.forEach(r => r.classList.remove('selected-row'));
                selectedHabitId = habitId;
                row.classList.add('selected-row');
                toggleActionButtons(true);
            }
        });
    });
}

// बटन चालू/बंद करने के लिए सहायक फंक्शन
function toggleActionButtons(enable) {
    const editBtn = document.getElementById('btn-edit');
    const deleteBtn = document.getElementById('btn-delete');
    const reorderBtn = document.getElementById('btn-reorder');

    if (enable) {
        [editBtn, deleteBtn, reorderBtn].forEach(btn => {
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.disabled = false;
        });
    } else {
        [editBtn, deleteBtn, reorderBtn].forEach(btn => {
            btn.classList.add('opacity-50', 'cursor-not-allowed');
            btn.disabled = true;
        });
    }
}

// चेकबॉक्स का टिक/अनटिक लॉजिक
function addCheckboxListeners() {
    const checkboxes = document.querySelectorAll('.habit-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', async (e) => {
            const habitId = e.target.getAttribute('data-habit-id');
            const day = e.target.getAttribute('data-day');
            const isChecked = e.target.checked;

            const month = document.getElementById('month-select').value;
            const year = document.getElementById('year-select').value;
            const formattedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            try {
                const response = await fetch(`${API_URL}/toggle-habit`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getToken()}`
                    },
                    body: JSON.stringify({ habit_id: habitId, date: formattedDate, completed: isChecked })
                });

                if (!response.ok) {
                    e.target.checked = !isChecked;
                    alert('सेव नहीं हो सका! कृपया दोबारा लॉगिन करें।');
                }
            } catch (error) {
                console.error(error);
                e.target.checked = !isChecked;
            }
        });
    });
}

// 1. ADD - नई आदत जोड़ने का लॉजिक
document.getElementById('habit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('habit-name');
    const name = nameInput.value.trim();

    if (!name) return;

    try {
        const response = await fetch(`${API_URL}/habits`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({ name: name, category: 'General', daily_goal: 1 })
        });

        if (response.ok) {
            nameInput.value = '';
            loadTracker();
        }
    } catch (err) {
        console.error(err);
    }
});

// 2. EDIT - सिलेक्टेड आदत एडिट करने का लॉजिक
document.getElementById('btn-edit').addEventListener('click', async () => {
    if (!selectedHabitId) {
        alert('पहले टेबल में से किसी एक आदत पर क्लिक करके उसे सिलेक्ट करें!');
        return;
    }

    const currentName = document.querySelector(`.habit-row[data-id="${selectedHabitId}"] .habit-name-text`).innerText;
    const newName = prompt('आदत का नया नाम दर्ज करें:', currentName);
    
    if (!newName || !newName.trim() || newName.trim() === currentName) return;

    try {
        const response = await fetch(`${API_URL}/habits/${selectedHabitId}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({ name: newName.trim() })
        });

        if (response.ok) {
            loadTracker();
        } else {
            alert('नाम बदलने में त्रुटि आई!');
        }
    } catch (err) {
        console.error(err);
    }
});

// 3. DELETE - सिलेक्टेड आदत हटाने का लॉजिक
document.getElementById('btn-delete').addEventListener('click', async () => {
    if (!selectedHabitId) {
        alert('पहले टेबल में से किसी एक आदत पर क्लिक करके उसे सिलेक्ट करें!');
        return;
    }

    const confirmDelete = confirm('क्या आप वाकई इस आदत को हटाना चाहते हैं? इसके सभी पुराने टिक/रिकॉर्ड भी डिलीट हो जाएंगे।');
    if (!confirmDelete) return;

    try {
        const response = await fetch(`${API_URL}/habits/${selectedHabitId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getToken()}`
            }
        });

        if (response.ok) {
            loadTracker();
        } else {
            alert('हटाने में विफलता!');
        }
    } catch (err) {
        console.error(err);
    }
});

// 4. POSITION - आदत की पोजीशन बदलने का लॉजिक
document.getElementById('btn-reorder').addEventListener('click', async () => {
    if (!selectedHabitId) {
        alert('पहले टेबल में से किसी एक आदत पर क्लिक करके उसे सिलेक्ट करें!');
        return;
    }

    const targetPos = prompt('आप इस आदत को किस नंबर (Position) पर रखना चाहते हैं? (उदा. 1, 2, 3...)');
    if (!targetPos || isNaN(targetPos)) return;

    try {
        const response = await fetch(`${API_URL}/habits-reorder`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getToken()}`
            },
            body: JSON.stringify({
                habitId: selectedHabitId,
                targetPosition: parseInt(targetPos)
            })
        });

        if (response.ok) {
            loadTracker();
        } else {
            alert('पोजीशन बदलने में त्रुटि!');
        }
    } catch (err) {
        console.error(err);
    }
});