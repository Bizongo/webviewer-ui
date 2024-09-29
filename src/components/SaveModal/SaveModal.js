import React, { useEffect, useState, useRef } from 'react';
import { useSelector, useDispatch, useStore } from 'react-redux';
import selectors from 'selectors';
import actions from 'actions';
import { useTranslation } from 'react-i18next';
import DataElements from 'constants/dataElement';
import Button from 'components/Button';
import { FocusTrap, Choice, Input } from '@pdftron/webviewer-react-toolkit';
import { Swipeable } from 'react-swipeable';
import core from 'core';
import classNames from 'classnames';
import Dropdown from 'components/Dropdown';
import PageNumberInput from 'components/PageReplacementModal/PageNumberInput';
import downloadPdf from 'helpers/downloadPdf';
import { isOfficeEditorMode } from 'helpers/officeEditor';
import { workerTypes } from 'constants/types';
import range from 'lodash/range';
import { clone } from 'lodash';
import { cropPageArray, getExtendedPageDimensions, WHITE_CROP, timeout, publish } from 'helpers/downloadPdf';

import './SaveModal.scss';

const PAGE_RANGES = {
  ALL: 'all',
  CURRENT_PAGE: 'currentPage',
  CURRENT_VIEW: 'currentView',
  SPECIFY: 'specify'
};
const FILE_TYPES = {
  OFFICE: { label: 'OFFICE (*.pptx,*.docx,*.xlsx)', extension: 'office' },
  PDF: { label: 'PDF (*.pdf)', extension: 'pdf', },
  IMAGE: { label: 'PNG (*.png)', extension: 'png', },
  OFFICE_EDITOR: { label: 'Word Document (*.docx)', extension: 'office', },
};
// These legacy office extensions return corrupted file data from the workers if downloaded as OFFICE
const CORRUPTED_OFFICE_EXTENSIONS = ['.ppt', '.xls'];

const SaveModal = () => {
  const store = useStore();
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const [isOpen, activeDocumentViewerKey] = useSelector((state) => [
    selectors.isElementOpen(state, DataElements.SAVE_MODAL),
    selectors.getActiveDocumentViewerKey(state),
  ]);

  const initalFileTypes = [FILE_TYPES.PDF, FILE_TYPES.IMAGE];
  const [fileTypes, setFileTypes] = useState(initalFileTypes);
  const [filename, setFilename] = useState('');
  const [filetype, setFiletype] = useState(fileTypes[0]);
  const [pageRange, setPageRange] = useState(PAGE_RANGES.ALL);
  const [specifiedPages, setSpecifiedPages] = useState();
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [includeComments, setIncludeComments] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [errorText, setErrorText] = useState('');
  const isWhiteSpaceEnable = !!window.isWhiteSpaceEnable;

  useEffect(() => {
    const keydownListener = (e) => {
      if (e.key === 'Enter') {
        isWhiteSpaceEnable ? onWhiteAnnotationsSave() : onSave();
      }
    };

    !saveDisabled && window.addEventListener('keydown', keydownListener);
    return () => window.removeEventListener('keydown', keydownListener);
  }, [
    activeDocumentViewerKey,
    saveDisabled,
    includeAnnotations,
    specifiedPages,
    includeComments,
    pageRange,
    filename,
    filetype,
  ]);

  useEffect(() => {
    const updateFile = async () => {
      const document = core.getDocument(activeDocumentViewerKey);
      if (document) {
        setFiletype(FILE_TYPES.PDF);
        setFileTypes(initalFileTypes);
        const filename = document.getFilename();
        const newFilename = filename.substring(0, filename.lastIndexOf('.')) || filename;
        setFilename(newFilename);
        const type = document.getType();
        if (type === workerTypes.OFFICE) {
          const array = filename.split('.');
          const extension = `.${array[array.length - 1]}`;
          if (!CORRUPTED_OFFICE_EXTENSIONS.includes(extension)) {
            setFileTypes([...initalFileTypes, FILE_TYPES.OFFICE]);
          }
          await document.getDocumentCompletePromise();
        } else if (type === workerTypes.OFFICE_EDITOR) {
          setFileTypes([
            FILE_TYPES.OFFICE_EDITOR,
            FILE_TYPES.PDF
          ]);
          setFiletype(FILE_TYPES.OFFICE_EDITOR);
        }
        setPageCount(core.getTotalPages(activeDocumentViewerKey));
      }
    };
    const documentUnloaded = () => {
      setFilename('');
      setPageCount(0);
      setFileTypes(initalFileTypes);
      setFiletype(initalFileTypes[0]);
      dispatch(actions.closeElement(DataElements.SAVE_MODAL));
    };
    updateFile();
    core.addEventListener('documentUnloaded', documentUnloaded, undefined, activeDocumentViewerKey);
    core.addEventListener('documentLoaded', updateFile, undefined, activeDocumentViewerKey);
    return () => {
      core.removeEventListener('documentUnloaded', documentUnloaded, activeDocumentViewerKey);
      core.removeEventListener('documentLoaded', updateFile, activeDocumentViewerKey);
    };
  }, [activeDocumentViewerKey]);

  useEffect(() => {
    const document = core.getDocument(activeDocumentViewerKey);

    if (isOfficeEditorMode() && document) {
      setFiletype(FILE_TYPES.OFFICE_EDITOR);
      const filename = document.getFilename();
      const newFilename = filename.substring(0, filename.lastIndexOf('.')) || filename;
      setFilename(newFilename);
    }
  }, [isOpen]);

  const closeModal = () => dispatch(actions.closeElement(DataElements.SAVE_MODAL));
  const preventDefault = (e) => e.preventDefault();
  const onFilenameChange = (e) => {
    setFilename(e?.target?.value);
  };
  const onFiletypeChange = (e) => {
    setFiletype(fileTypes.find((i) => i.label === e));
    if (e === FILE_TYPES.OFFICE.label) {
      setPageRange(PAGE_RANGES.ALL);
    }
  };
  const onPageRangeChange = (e) => {
    if (e.target.classList.contains('page-number-input')) {
      return;
    }
    setPageRange(e.target.value);
    if (errorText) {
      setHasTyped(false);
      clearError();
    }
  };
  const onIncludeAnnotationsChanged = () => setIncludeAnnotations(!includeAnnotations);
  const onIncludeCommentsChanged = () => setIncludeComments(!includeComments);
  const clearError = () => setErrorText('');
  const onError = () => setErrorText(t('saveModal.pageError') + pageCount);
  const onSpecifiedPagesChanged = (pageNumbers) => {
    if (!hasTyped) {
      setHasTyped(true);
    }

    if (pageNumbers.length > 0) {
      clearError();
    }
  };
  const onWhiteAnnotationsSave = async () => {
    if (!filename) {
      return;
    }
    publish('SAVING_FILE', true);
    let pages;
    if (pageRange === PAGE_RANGES.SPECIFY) {
      pages = specifiedPages?.length ? specifiedPages : [core.getCurrentPage(activeDocumentViewerKey)];
    } else if (pageRange === PAGE_RANGES.CURRENT_PAGE) {
      pages = [core.getCurrentPage(activeDocumentViewerKey)];
    } else if (pageRange === PAGE_RANGES.CURRENT_VIEW) {
      pages = [core.getCurrentPage(activeDocumentViewerKey)];
    } else {
      pages = range(1, core.getTotalPages(activeDocumentViewerKey) + 1, 1);
    }

    let documentViewer = core.getDocumentViewer(activeDocumentViewerKey);
    let doc = core.getDocument(activeDocumentViewerKey);
    let annotationManager = core.getAnnotationManager();
    let whiteAnnotations = clone(annotationManager?.getAnnotationsList() || []);
    let documentInfo = {};

    for (let i = 1; i <= doc.getPageCount(); i++) {
      const pageHeight = clone(documentViewer.getPageHeight(i));
      const pageWidth = clone(documentViewer.getPageWidth(i));
      const croppedHeight = pageHeight - 2 * WHITE_CROP;
      const croppedWidth = pageWidth - 2 * WHITE_CROP;

      documentInfo[i] = {
        Page: {
          Height: croppedHeight,
          Width: croppedWidth,
          x1: WHITE_CROP,
          y1: WHITE_CROP,
          x2: croppedWidth + WHITE_CROP,
          y2: croppedHeight + WHITE_CROP
        },
        Annotation: []
      };

      for (const item of whiteAnnotations) {
        if (item.PageNumber === i) {
          documentInfo[i].Annotation.push({
            Height: item.Height,
            Width: item.Width,
            x1: item.X,
            y1: item.Y,
            x2: item.X + item.Width,
            y2: item.Y + item.Height
          });
        }
      }
    }

    let xfdfString = clone(await annotationManager.exportAnnotations());

    let cropBox = getExtendedPageDimensions(documentInfo, includeAnnotations);

    await annotationManager.deleteAnnotations((annotationManager?.getAnnotationsList() || []), { force: true });

    await timeout(100);

    await cropPageArray(doc, cropBox);

    await timeout(100);

    let annotations = await annotationManager.importAnnotations(xfdfString);
    annotations.forEach((a) => {
      annotationManager.redrawAnnotation(a);
    });

    await timeout(100);

    await downloadPdf(dispatch, {
      includeAnnotations,
      includeComments,
      filename: filename || 'untitled',
      downloadType: filetype.extension,
      pages,
      store,
    }, activeDocumentViewerKey);

    await timeout(100);

    await annotationManager.deleteAnnotations(annotationManager?.getAnnotationsList(), { force: true });

    await timeout(100);

    await cropPageArray(doc, cropBox, true);

    await timeout(100);

    annotations = await annotationManager.importAnnotations(xfdfString);
    annotations.forEach((a) => {
      annotationManager.redrawAnnotation(a);
    });

    closeModal();
    publish('SAVING_FILE', false);
  };
  const onSave = () => {
    if (!filename) {
      return;
    }

    let pages;
    if (pageRange === PAGE_RANGES.SPECIFY) {
      pages = specifiedPages?.length ? specifiedPages : [core.getCurrentPage(activeDocumentViewerKey)];
    } else if (pageRange === PAGE_RANGES.CURRENT_PAGE) {
      pages = [core.getCurrentPage(activeDocumentViewerKey)];
    } else if (pageRange === PAGE_RANGES.CURRENT_VIEW) {
      pages = [core.getCurrentPage(activeDocumentViewerKey)];
    } else {
      pages = range(1, core.getTotalPages(activeDocumentViewerKey) + 1, 1);
    }

    downloadPdf(dispatch, {
      includeAnnotations,
      includeComments,
      filename: filename || 'untitled',
      downloadType: filetype.extension,
      pages,
      store,
    }, activeDocumentViewerKey);

    closeModal();
  };

  const [hasTyped, setHasTyped] = useState(false);
  const saveDisabled = (errorText || !hasTyped) && pageRange === PAGE_RANGES.SPECIFY || !filename;

  const optionsDisabled = filetype.extension === 'office' || isOfficeEditorMode();

  const customPagesLabelElement = (
    <div className={classNames('page-number-input-container', { error: !!errorText })}>
      <label className={'specifyPagesChoiceLabel'}>
        <span>
          {t('option.print.specifyPages')}
        </span>
        {pageRange === PAGE_RANGES.SPECIFY && <span className='specifyPagesExampleLabel'>
          - {t('option.thumbnailPanel.multiSelectPagesExample')}
        </span>}
      </label>
      {pageRange === PAGE_RANGES.SPECIFY &&
        <PageNumberInput
          selectedPageNumbers={specifiedPages}
          pageCount={pageCount}
          onBlurHandler={setSpecifiedPages}
          onSelectedPageNumbersChange={onSpecifiedPagesChanged}
          onError={onError}
          pageNumberError={errorText}
        />
      }
    </div>
  );

  return (
    <Swipeable onSwipedUp={closeModal} onSwipedDown={closeModal} preventDefaultTouchmoveEvent>
      <FocusTrap locked={isOpen}>
        <div className={classNames('SaveModal', { open: isOpen, closed: !isOpen })} data-element={DataElements.SAVE_MODAL}>
          <div className='container'>
            <div className='header'>
              <div className='header-text' >{t('saveModal.saveAs')}</div>
              <Button className='close-button' onClick={closeModal} img='ic_close_black_24px' title='action.close' />
            </div>
            <div className='modal-body'>
              <div className='title'>{t('saveModal.general')}</div>
              <div className='input-container'>
                <label htmlFor='fileNameInput' className='label'>{t('saveModal.fileName')}</label>
                <Input
                  type='text'
                  id='fileNameInput'
                  data-testid="fileNameInput"
                  onChange={onFilenameChange}
                  value={filename}
                  fillWidth="false"
                  padMessageText={true}
                  messageText={filename === '' ? t('saveModal.fileNameCannotBeEmpty') : ''}
                  message={filename === '' ? 'warning' : 'default'}
                />
              </div>
              <div className='input-container'>
                <div className='label'>{t('saveModal.fileType')}</div>
                <Dropdown
                  items={fileTypes.map((i) => i.label)}
                  onClickItem={onFiletypeChange}
                  currentSelectionKey={filetype.label}
                />
              </div>
              {!optionsDisabled && (<>
                <div className='title'>{t('saveModal.pageRange')}</div>
                <form className='radio-container' onChange={onPageRangeChange} onSubmit={preventDefault}>
                  <div className='page-range-column'>
                    <Choice
                      checked={pageRange === PAGE_RANGES.ALL}
                      radio
                      name='page-range-option'
                      label={t('saveModal.all')}
                      value={PAGE_RANGES.ALL}
                    />
                    <Choice
                      checked={pageRange === PAGE_RANGES.CURRENT_PAGE}
                      radio
                      name='page-range-option'
                      label={t('saveModal.currentPage')}
                      value={PAGE_RANGES.CURRENT_PAGE}
                    />
                  </div>
                  <div className='page-range-column custom-page-ranges'>
                    <Choice
                      checked={pageRange === PAGE_RANGES.SPECIFY}
                      radio
                      name='page-range-option'
                      label={customPagesLabelElement}
                      value={PAGE_RANGES.SPECIFY}
                    />
                  </div>
                </form>
                <div className='title'>{t('saveModal.properties')}</div>
                <div className='checkbox-container'>
                  <Choice
                    checked={includeAnnotations}
                    name='include-annotation-option'
                    label={t('saveModal.includeAnnotation')}
                    onChange={onIncludeAnnotationsChanged}
                  />
                  {/* <Choice
                    checked={includeComments}
                    name='include-comment-option'
                    label={t('saveModal.includeComments')}
                    onChange={onIncludeCommentsChanged}
                  /> */}
                </div>
              </>)}
            </div>
            <div className='footer'>
              <Button disabled={saveDisabled} onClick={() => isWhiteSpaceEnable ? onWhiteAnnotationsSave() : onSave()} label={t('saveModal.save')} />
            </div>
          </div>
        </div>
      </FocusTrap>
    </Swipeable>
  );
};

export default SaveModal;
