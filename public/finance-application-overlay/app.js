const qs = new URLSearchParams(window.location.search);
const PREVIEW = qs.get('preview') === '1';
const STORAGE_KEY = 'financeApplicationOverlayV1';
const IDEAL_POSTCODES_API_KEY = 'ak_mmkd4r5iC7N4f09TGBkjMzYCo9But';
const THANK_YOU_URL = 'https://www.vanfinancecompany.co.uk/finance-application-received';

const form = document.getElementById('financeForm');
const root = document.getElementById('stepRoot');
const backButton = document.getElementById('backButton');
const continueButton = document.getElementById('continueButton');
const stepLabel = document.getElementById('stepLabel');
const progressLabel = document.getElementById('progressLabel');
const progressFill = document.getElementById('progressFill');
const successLayer = document.getElementById('successLayer');

const state = {
  applicationType:'', businessProperty:'', title:'', maritalStatus:'', licenceType:'', residentialStatus:'', employmentStatus:'', partExchange:'', hearAboutUs:'',
  company_name:'', nature_of_business:'', vat_number:'', company_registration_number:'', business_full_address:'', business_postcode:'',
  first_name:'', last_name:'', email:'', phone:'', dob_day:'', dob_month:'', dob_year:'', current_full_address:'', current_postcode:'', time_at_address_years:'', time_at_address_months:'',
  previous_full_address:'', previous_address_years:'', previous_address_months:'', previous2_full_address:'', previous2_address_years:'', previous2_address_months:'', previous3_full_address:'', previous3_address_years:'', previous3_address_months:'',
  employer_name:'', occupation:'', current_job_years:'', current_job_months:'', annual_net_salary:'', available_deposit:'', vehicle_registration:'', vehicle_make:'', vehicle_model:'', vehicle_mileage:'', part_exchange_condition:'', part_exchange_value:'', hear_about_us_other:'',
  bank_account_name:'', bank_sort_code:'', bank_account_number:'', agree_submit:false
};

let currentIndex = 0;
let validationText = '';

const escapeHtml = (value='') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const digitsOnly = value => String(value || '').replace(/\D/g,'');
const numberValue = value => Number.parseInt(String(value || '0'),10) || 0;
const months = (y,m) => numberValue(y)*12 + numberValue(m);
const addressMonths = () => months(state.time_at_address_years,state.time_at_address_months)+months(state.previous_address_years,state.previous_address_months)+months(state.previous2_address_years,state.previous2_address_months)+months(state.previous3_address_years,state.previous3_address_months);
const durationYearKeys = new Set(['time_at_address_years','previous_address_years','previous2_address_years','previous3_address_years','current_job_years']);
const durationMonthKeys = new Set(['time_at_address_months','previous_address_months','previous2_address_months','previous3_address_months','current_job_months']);

function normaliseBoundValue(key,value){
  if(key==='phone') return digitsOnly(value).slice(0,11);
  if(durationYearKeys.has(key)) return digitsOnly(value).slice(0,2);
  if(durationMonthKeys.has(key)){
    const digits=digitsOnly(value).slice(0,2);
    if(digits==='') return '';
    return String(Math.min(12,numberValue(digits)));
  }
  return value;
}

function choice(name,label,options,single=false){return {type:'choice',name,label,options,single};}
function input(name,label,type='text',attrs={}){return {type:'input',name,label,inputType:type,attrs};}
function textarea(name,label){return {type:'textarea',name,label};}
function address(prefix,label){return {type:'address',prefix,label};}
function checkbox(name,label){return {type:'checkbox',name,label};}

function allSteps(){
  const isLimited = state.applicationType === 'Limited Company';
  const wantsPX = state.partExchange === 'Yes';
  const current = months(state.time_at_address_years,state.time_at_address_months);
  const p1 = months(state.previous_address_years,state.previous_address_months);
  const p2 = months(state.previous2_address_years,state.previous2_address_months);
  const need1 = current > 0 && current < 36;
  const need2 = need1 && current + p1 < 36;
  const need3 = need2 && current + p1 + p2 < 36;
  const steps = [
    {id:'application_type',eyebrow:'Start here',title:'What best describes your application?',subtitle:'Choose the option that matches how you earn or trade.',fields:[choice('applicationType','Application type',['Limited Company','Employed','Self Employed','Other'])],trust:true},
    ...(isLimited ? [
      {id:'company_details',eyebrow:'Company',title:'Company details',subtitle:'Please provide the registered company details.',fields:[input('company_name','Limited Company Name'),input('nature_of_business','Nature of Business'),input('vat_number','VAT number if applicable')]},
      {id:'company_registration',eyebrow:'Company',title:'Registration details',subtitle:'Now add the company registration information.',fields:[input('company_registration_number','Company Registration Number'),choice('businessProperty','Business property',['Owned','Leased / Rented','Other'],true)]},
      {id:'business_address',eyebrow:'Company',title:'Registered address',subtitle:'Use postcode lookup, then select the registered business address.',fields:[address('business','Business address')]}
    ] : []),
    {id:'applicant_details',eyebrow:'About you',title:'Tell us about you',subtitle:'Please complete your personal details.',fields:[choice('title','Title',['Mr','Mrs','Miss','Ms']),input('first_name','First Name'),input('last_name','Last Name')]},
    {id:'contact_details',eyebrow:'About you',title:'Contact details',subtitle:'Use the details you want us to contact you on.',fields:[input('email','Email','email'),input('phone','Phone','tel',{maxlength:11,inputmode:'numeric',autocomplete:'tel'})]},
    {id:'marital_status',eyebrow:'About you',title:'Marital status',subtitle:'Please confirm your marital status.',fields:[choice('maritalStatus','Marital status',['Married','Single','Living with Partner','Widowed','Divorced','Other'],true)]},
    {id:'licence_type',eyebrow:'About you',title:'Driving licence',subtitle:'Please confirm your driving licence type.',fields:[choice('licenceType','Licence type',['Full UK','EU Licence','Provisional','None','Other'],true)]},
    {id:'dob',eyebrow:'About you',title:'Date of birth',subtitle:'Applicants must be at least 18 years old.',fields:[input('dob_day','Day','text',{maxlength:2,inputmode:'numeric'}),input('dob_month','Month','text',{maxlength:2,inputmode:'numeric'}),input('dob_year','Year','text',{maxlength:4,inputmode:'numeric'})],layout:'three'},
    {id:'current_address',eyebrow:'Address history',title:'Where do you live now?',subtitle:'Use postcode lookup, then select your address.',fields:[address('current','Current address')]},
    {id:'time_at_address',eyebrow:'Address history',title:'Time at address',subtitle:'Please confirm how long you have lived there.',fields:[input('time_at_address_years','Years','text',{inputmode:'numeric',maxlength:2}),input('time_at_address_months','Months','text',{inputmode:'numeric',maxlength:2})],layout:'two'},
    {id:'residential_status',eyebrow:'Address history',title:'Residential status',subtitle:'Please confirm your current residential status.',fields:[choice('residentialStatus','Residential status',['Homeowner','Private Tenant','Council Tenant','Living with Parents','Other'],true)]},
    ...(need1 ? [{id:'previous_address_1',eyebrow:'Address history',title:'Previous address',subtitle:'We need a little more address history to reach 3 years.',fields:[address('prev1','Previous address')]},{id:'previous_time_1',eyebrow:'Address history',title:'Time at previous address',subtitle:'Please confirm how long you lived there.',fields:[input('previous_address_years','Years','text',{inputmode:'numeric',maxlength:2}),input('previous_address_months','Months','text',{inputmode:'numeric',maxlength:2})],layout:'two'}] : []),
    ...(need2 ? [{id:'previous_address_2',eyebrow:'Address history',title:'Previous address 2',subtitle:'We still need more address history.',fields:[address('prev2','Previous address 2')]},{id:'previous_time_2',eyebrow:'Address history',title:'Time at previous address 2',subtitle:'Please confirm how long you lived there.',fields:[input('previous2_address_years','Years','text',{inputmode:'numeric',maxlength:2}),input('previous2_address_months','Months','text',{inputmode:'numeric',maxlength:2})],layout:'two'}] : []),
    ...(need3 ? [{id:'previous_address_3',eyebrow:'Address history',title:'Previous address 3',subtitle:'One final previous address may be required.',fields:[address('prev3','Previous address 3')]},{id:'previous_time_3',eyebrow:'Address history',title:'Time at previous address 3',subtitle:'Please confirm how long you lived there.',fields:[input('previous3_address_years','Years','text',{inputmode:'numeric',maxlength:2}),input('previous3_address_months','Months','text',{inputmode:'numeric',maxlength:2})],layout:'two'}] : []),
    {id:'work_income',eyebrow:'Employment',title:'Work and income',subtitle:'Share your employment details and time in your current role.',fields:[choice('employmentStatus','Employment Status',['Full Time Employed','Self Employed']),...(state.employmentStatus==='Full Time Employed'?[input('employer_name','Employer Name')]:[]),input('occupation','Occupation'),input('current_job_years','Years in current job','text',{inputmode:'numeric',maxlength:2}),input('current_job_months','Months in current job','text',{inputmode:'numeric',maxlength:2})]},
    {id:'budget_deposit',eyebrow:'Finance',title:'Budget and deposit',subtitle:'Please confirm your income and available deposit.',fields:[input('annual_net_salary','Annual Net Salary','text',{inputmode:'numeric'}),input('available_deposit','Available Deposit','text',{inputmode:'numeric'}),choice('partExchange','Do you have a vehicle to part exchange?',['Yes','No'])]},
    ...(wantsPX ? [{id:'vehicle_details',eyebrow:'Part exchange',title:'Vehicle details',subtitle:'Add the part exchange vehicle details.',fields:[input('vehicle_registration','Vehicle Registration'),input('vehicle_make','Make'),input('vehicle_model','Model'),input('vehicle_mileage','Mileage','text',{inputmode:'numeric'})]},{id:'vehicle_condition_value',eyebrow:'Part exchange',title:'Condition and value',subtitle:'Tell us about the part exchange vehicle.',fields:[textarea('part_exchange_condition','Condition'),input('part_exchange_value','Estimated Part Exchange Value','text',{inputmode:'numeric'})]}] : []),
    {id:'referral',eyebrow:'Nearly there',title:'How did you hear about us?',subtitle:'Please tell us how you found Van Finance Company.',fields:[choice('hearAboutUs','Source',['Google','Bing','Ebay','Facebook','Radio','Other']),...(state.hearAboutUs==='Other'?[input('hear_about_us_other','Please tell us where you heard about us')]:[])]},
    {id:'bank',eyebrow:'Final step',title:'Almost finished',subtitle:'Enter your bank details and submit your application.',fields:[input('bank_account_name','Bank Account Name'),input('bank_sort_code','Bank Account Sort Code','text',{inputmode:'numeric',maxlength:8}),input('bank_account_number','Bank Account Number','text',{inputmode:'numeric',maxlength:8}),checkbox('agree_submit','I agree to the privacy policy and consent to submit this application.')],layout:'two'}
  ];
  return steps;
}

const prefixMap = {
  business:{postcode:'business_postcode',address:'business_full_address'},
  current:{postcode:'current_postcode',address:'current_full_address'},
  prev1:{postcode:'prev1_postcode',address:'previous_full_address'},
  prev2:{postcode:'prev2_postcode',address:'previous2_full_address'},
  prev3:{postcode:'prev3_postcode',address:'previous3_full_address'}
};

function fieldHtml(field){
  if(field.type==='choice') return `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="choices ${field.single?'single':''}" data-choice="${field.name}">${field.options.map(v=>`<button type="button" class="choice ${state[field.name]===v?'active':''}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}</div></div>`;
  if(field.type==='textarea') return `<div class="field"><label for="${field.name}">${escapeHtml(field.label)}</label><textarea class="control" id="${field.name}" data-state="${field.name}">${escapeHtml(state[field.name])}</textarea></div>`;
  if(field.type==='checkbox') return `<label class="checkbox-box"><input type="checkbox" data-state="${field.name}" ${state[field.name]?'checked':''}/><span>${escapeHtml(field.label)}</span></label>`;
  if(field.type==='address'){
    const map=prefixMap[field.prefix], postcode=state[map.postcode]||''; const addressValue=state[map.address]||'';
    return `<div class="field"><div class="field-label">${escapeHtml(field.label)}</div><div class="address-row"><input class="control" id="${field.prefix}Postcode" data-address-postcode="${field.prefix}" value="${escapeHtml(postcode)}" placeholder="Postcode" autocomplete="postal-code"/><button class="lookup-button" type="button" data-lookup="${field.prefix}">Find address</button></div><select class="control hidden" id="${field.prefix}Select" data-address-select="${field.prefix}"><option value="">Select address</option></select><textarea class="control manual-address" data-state="${map.address}" placeholder="Full address">${escapeHtml(addressValue)}</textarea><div class="field-hint">You can use postcode lookup or enter the address manually.</div></div>`;
  }
  const attrs=Object.entries(field.attrs||{}).map(([k,v])=>`${k}="${escapeHtml(v)}"`).join(' ');
  return `<div class="field"><label for="${field.name}">${escapeHtml(field.label)}</label><input class="control" id="${field.name}" type="${field.inputType||'text'}" data-state="${field.name}" value="${escapeHtml(state[field.name])}" ${attrs}/></div>`;
}

function render(){
  const steps=allSteps();
  if(currentIndex>=steps.length) currentIndex=steps.length-1;
  const step=steps[currentIndex];
  const percent=Math.round(((currentIndex+1)/steps.length)*100);
  stepLabel.textContent=`Step ${currentIndex+1} of ${steps.length}`;
  progressLabel.textContent=`${percent}%`;
  progressFill.style.width=`${percent}%`;
  const layout=step.layout==='three'?'three':step.layout==='two'?'two':'';
  root.innerHTML=`<div class="step-inner"><div class="step-eyebrow">${escapeHtml(step.eyebrow)}</div><h1 class="step-title">${escapeHtml(step.title)}</h1><p class="step-subtitle">${escapeHtml(step.subtitle)}</p><div class="field-grid ${layout}">${step.fields.map(fieldHtml).join('')}</div>${step.trust?'<div class="trust-strip"><div class="trust-item"><strong>✓</strong>About 2 minutes</div><div class="trust-item"><strong>✓</strong>Fast decision</div><div class="trust-item"><strong>✓</strong>Secure application</div></div>':''}<div class="validation-message" id="validationMessage">${escapeHtml(validationText)}</div></div>`;
  backButton.style.visibility=currentIndex===0?'hidden':'visible';
  continueButton.textContent=step.id==='bank'?'Submit application':'Continue';
  bindRenderedControls(step);
  saveDraft();
  window.scrollTo({top:0,behavior:'smooth'});
}

function bindRenderedControls(step){
  root.querySelectorAll('[data-state]').forEach(el=>{
    const key=el.dataset.state;
    const sync=()=>{
      if(el.type==='checkbox') state[key]=el.checked;
      else {
        const normalised=normaliseBoundValue(key,el.value);
        if(normalised!==el.value) el.value=normalised;
        state[key]=normalised;
      }
      validationText=''; saveDraft(); if(['employmentStatus','partExchange','hearAboutUs'].includes(key)) render();
    };
    el.addEventListener('input',sync); el.addEventListener('change',sync);
  });
  root.querySelectorAll('[data-choice]').forEach(group=>group.querySelectorAll('.choice').forEach(btn=>btn.addEventListener('click',()=>{
    state[group.dataset.choice]=btn.dataset.value; validationText=''; saveDraft();
    if(group.dataset.choice==='applicationType'){setTimeout(()=>{if(validateStep(step)){currentIndex++;render();}},120);} else render();
  })));
  root.querySelectorAll('[data-lookup]').forEach(btn=>btn.addEventListener('click',()=>lookupAddress(btn.dataset.lookup,btn)));
  root.querySelectorAll('[data-address-select]').forEach(select=>select.addEventListener('change',()=>selectAddress(select.dataset.addressSelect,select)));
}

function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim());}
function validPhone(v){return /^(0[12378]\d{9})$/.test(digitsOnly(v));}
function adult(){const d=numberValue(state.dob_day),m=numberValue(state.dob_month),y=numberValue(state.dob_year);if(!d||!m||!y)return false;const dob=new Date(y,m-1,d);if(dob.getFullYear()!==y||dob.getMonth()!==m-1||dob.getDate()!==d)return false;const today=new Date();let age=today.getFullYear()-y;const had=today.getMonth()>m-1||(today.getMonth()===m-1&&today.getDate()>=d);if(!had)age--;return age>=18;}
function requireValue(key,msg){if(!String(state[key]||'').trim()){validationText=msg;return false;}return true;}
function validDuration(y,m){const yy=String(state[y]||'').trim(),mm=String(state[m]||'').trim();if(yy===''||mm==='')return false;return numberValue(yy)>=0&&numberValue(yy)<=99&&numberValue(mm)>=0&&numberValue(mm)<=12;}

function validateStep(step){
  validationText='';
  const id=step.id;
  if(id==='application_type') return requireValue('applicationType','Please choose an application type.');
  if(id==='company_details') return requireValue('company_name','Please enter the limited company name.')&&requireValue('nature_of_business','Please enter the nature of business.');
  if(id==='company_registration') return requireValue('company_registration_number','Please enter the company registration number.')&&requireValue('businessProperty','Please choose the business property status.');
  if(id==='business_address') return requireValue('business_full_address','Please enter the registered business address.');
  if(id==='applicant_details') return requireValue('title','Please choose your title.')&&requireValue('first_name','Please enter your first name.')&&requireValue('last_name','Please enter your last name.');
  if(id==='contact_details'){if(!validEmail(state.email)){validationText='Please enter a valid email address.';return false;}if(!validPhone(state.phone)){validationText='Please enter a valid 11-digit UK phone number.';return false;}return true;}
  if(id==='marital_status') return requireValue('maritalStatus','Please choose your marital status.');
  if(id==='licence_type') return requireValue('licenceType','Please choose your licence type.');
  if(id==='dob'){if(!adult()){validationText='Please enter a valid date of birth. Applicant must be at least 18.';return false;}return true;}
  if(id==='current_address') return requireValue('current_full_address','Please enter your current address.');
  if(id==='time_at_address'){if(!validDuration('time_at_address_years','time_at_address_months')||months(state.time_at_address_years,state.time_at_address_months)<=0){validationText='Please enter how long you have lived at your current address.';return false;}return true;}
  if(id==='residential_status') return requireValue('residentialStatus','Please choose your residential status.');
  if(id==='previous_address_1') return requireValue('previous_full_address','Please enter your previous address.');
  if(id==='previous_time_1'){if(!validDuration('previous_address_years','previous_address_months')){validationText='Please enter the time at your previous address.';return false;}return true;}
  if(id==='previous_address_2') return requireValue('previous2_full_address','Please enter previous address 2.');
  if(id==='previous_time_2'){if(!validDuration('previous2_address_years','previous2_address_months')){validationText='Please enter the time at previous address 2.';return false;}return true;}
  if(id==='previous_address_3') return requireValue('previous3_full_address','Please enter previous address 3.');
  if(id==='previous_time_3'){if(!validDuration('previous3_address_years','previous3_address_months')){validationText='Please enter the time at previous address 3.';return false;}return true;}
  if(id==='work_income'){if(!requireValue('employmentStatus','Please choose your employment status.'))return false;if(state.employmentStatus==='Full Time Employed'&&!requireValue('employer_name','Please enter your employer name.'))return false;if(!requireValue('occupation','Please enter your occupation.'))return false;if(!validDuration('current_job_years','current_job_months')){validationText='Please enter your time in the current job.';return false;}return true;}
  if(id==='budget_deposit') return requireValue('annual_net_salary','Please enter your annual net salary.')&&requireValue('available_deposit','Please enter your available deposit.')&&requireValue('partExchange','Please tell us if you have a part exchange.');
  if(id==='vehicle_details') return requireValue('vehicle_registration','Please enter the part exchange registration.')&&requireValue('vehicle_make','Please enter the make.')&&requireValue('vehicle_model','Please enter the model.')&&requireValue('vehicle_mileage','Please enter the mileage.');
  if(id==='referral'){if(!requireValue('hearAboutUs','Please tell us how you heard about us.'))return false;if(state.hearAboutUs==='Other'&&!requireValue('hear_about_us_other','Please tell us where you heard about us.'))return false;return true;}
  if(id==='bank'){if(!requireValue('bank_account_name','Please enter the bank account name.'))return false;if(digitsOnly(state.bank_sort_code).length!==6){validationText='Please enter a valid 6-digit sort code.';return false;}if(digitsOnly(state.bank_account_number).length!==8){validationText='Please enter a valid 8-digit account number.';return false;}if(!state.agree_submit){validationText='Please agree to the privacy policy before submitting.';return false;}return true;}
  return true;
}

async function lookupAddress(prefix,button){
  const map=prefixMap[prefix], postcodeInput=document.getElementById(`${prefix}Postcode`), select=document.getElementById(`${prefix}Select`);
  const postcode=String(postcodeInput?.value||'').replace(/\s+/g,'').toUpperCase();
  if(!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i.test(postcode)){validationText='Please enter a valid UK postcode.';render();return;}
  button.disabled=true; button.textContent='Finding…';
  try{
    const response=await fetch(`https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(postcode)}?api_key=${encodeURIComponent(IDEAL_POSTCODES_API_KEY)}`);
    const data=await response.json();
    const results=Array.isArray(data.result)?data.result:[];
    if(!results.length) throw new Error('No addresses found for that postcode.');
    select.innerHTML='<option value="">Select address</option>'+results.map(item=>`<option value="${encodeURIComponent(JSON.stringify(item))}">${escapeHtml([item.line_1,item.line_2,item.line_3,item.post_town,item.postcode].filter(Boolean).join(', '))}</option>`).join('');
    select.classList.remove('hidden');
    select.focus();
  }catch(error){validationText=error.message||'Address lookup failed. Please enter the address manually.';render();}
  finally{button.disabled=false;button.textContent='Find address';}
}

function selectAddress(prefix,select){
  if(!select.value)return;
  try{
    const item=JSON.parse(decodeURIComponent(select.value)); const map=prefixMap[prefix];
    state[map.address]=[item.organisation_name,item.premise,item.sub_building_name,item.line_1,item.line_2,item.line_3,item.post_town,item.postcode].filter(Boolean).join(', ');
    state[map.postcode]=item.postcode||''; validationText=''; saveDraft(); render();
  }catch(_){validationText='Please select the address again.';render();}
}

function collectPayload(){
  const payload={...state};
  payload.submitted_at=new Date().toLocaleString('en-GB');
  payload.application_route=document.getElementById('applicationRoute').value||'';
  payload.total_address_months=String(addressMonths());
  payload.vehicle_info=document.getElementById('vehicleInfo').value||'';
  payload.vehicle_title=document.getElementById('vehicleTitle').value||'';
  payload.vehicle_page_url=document.getElementById('vehiclePageUrl').value||'';
  payload.bank_sort_code=digitsOnly(payload.bank_sort_code);
  payload.bank_account_number=digitsOnly(payload.bank_account_number);
  return payload;
}

function submitViaParent(payload){
  if(PREVIEW) return Promise.resolve({ok:true,id:'preview-only'});
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(fn,value)=>{if(done)return;done=true;window.removeEventListener('message',listener);clearTimeout(timer);fn(value);};
    const listener=event=>{const data=event.data||{};if(data.type!=='finance-submit-result')return;data.ok?finish(resolve,data):finish(reject,new Error(data.message||'We could not submit your application. Please try again.'));};
    const timer=setTimeout(()=>finish(reject,new Error('We could not submit your application. Please try again.')),15000);
    window.addEventListener('message',listener);
    window.parent.postMessage({type:'finance-submit',payload},'*');
  });
}

async function submitApplication(){
  continueButton.disabled=true; continueButton.textContent='Submitting…';
  try{
    const payload=collectPayload(); await submitViaParent(payload); localStorage.removeItem(STORAGE_KEY); successLayer.hidden=false;
    if(!PREVIEW)setTimeout(()=>window.parent.postMessage({type:'finance-form-submitted',redirectUrl:THANK_YOU_URL},'*'),1300);
  }catch(error){validationText=error.message||'Something went wrong. Please try again.';continueButton.disabled=false;render();}
}

function saveDraft(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(_){}}
function restoreDraft(){try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(saved&&typeof saved==='object')Object.keys(state).forEach(key=>{if(saved[key]!==undefined)state[key]=saved[key];});}catch(_){}}

function applyVehicleContext(data={}){
  const title=data.vehicleTitle||qs.get('vehicleTitle')||document.getElementById('vehicleTitle').value||'';
  const info=data.vehicleInfo||qs.get('vehicleInfo')||document.getElementById('vehicleInfo').value||'';
  const url=data.vehiclePageUrl||qs.get('vehiclePageUrl')||document.getElementById('vehiclePageUrl').value||'';
  document.getElementById('vehicleTitle').value=title; document.getElementById('vehicleInfo').value=info; document.getElementById('vehiclePageUrl').value=url;
  document.getElementById('vehicleTitleDisplay').textContent=title||'Your selected van';
  document.getElementById('vehicleInfoDisplay').textContent=info||'Vehicle details will be attached automatically.';
}

backButton.addEventListener('click',()=>{if(currentIndex>0){currentIndex--;validationText='';render();}});
continueButton.addEventListener('click',async()=>{const steps=allSteps(),step=steps[currentIndex];if(!validateStep(step)){render();return;}if(step.id==='bank'){await submitApplication();return;}currentIndex++;validationText='';render();});
document.getElementById('closeApplication').addEventListener('click',()=>window.parent.postMessage({type:'finance-overlay-close'},'*'));

window.addEventListener('message',event=>{const data=event.data||{};if(data.type==='vehicle-data'){applyVehicleContext(data);saveDraft();}});

restoreDraft();
applyVehicleContext();
render();
window.parent.postMessage({type:'iframe-ready'},'*');
setTimeout(()=>window.parent.postMessage({type:'request-parent-page-data'},'*'),250);
