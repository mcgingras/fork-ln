import { Row, Col, Button, Card, Spinner } from 'react-bootstrap';
import Section from '../../layout/Section';
import {
  ProposalState,
  useExecuteProposal,
  useProposal,
  useQueueProposal,
  useCancelProposal,
} from '../../wrappers/nounsDao';
import { useUserVotesAsOfBlock } from '../../wrappers/nounToken';
import classes from './Vote.module.css';
import { RouteComponentProps } from 'react-router-dom';
import { TransactionStatus, useBlockNumber, useEthers } from '@usedapp/core';
import { AlertModal, setAlertModal } from '../../state/slices/application';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import advanced from 'dayjs/plugin/advancedFormat';
import VoteModal from '../../components/VoteModal';
import { useCallback, useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks';
import clsx from 'clsx';
import ProposalHeader from '../../components/ProposalHeader';
import ProposalContent from '../../components/ProposalContent';
import VoteCard, { VoteCardVariant } from '../../components/VoteCard';
import { useQuery } from '@apollo/client';
import {
  proposalVotesQuery,
  delegateNounsAtBlockQuery,
  ProposalVotes,
  Delegates,
} from '../../wrappers/subgraph';
import { getNounVotes } from '../../utils/getNounsVotes';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);

const AVERAGE_BLOCK_TIME_IN_SECS = 13;

const VotePage = ({
  match: {
    params: { id },
  },
}: RouteComponentProps<{ id: string }>) => {
  const proposal = useProposal(id);
  const { account } = useEthers();

  const [showVoteModal, setShowVoteModal] = useState<boolean>(false);
  const [isDelegateView, setIsDelegateView] = useState(false);

  const [isQueuePending, setQueuePending] = useState<boolean>(false);
  const [isExecutePending, setExecutePending] = useState<boolean>(false);
  const [isCancelPending, setCancelPending] = useState<boolean>(false);

  const dispatch = useAppDispatch();
  const setModal = useCallback((modal: AlertModal) => dispatch(setAlertModal(modal)), [dispatch]);

  const { queueProposal, queueProposalState } = useQueueProposal();
  const { executeProposal, executeProposalState } = useExecuteProposal();
  const { cancelProposal, cancelProposalState } = useCancelProposal();

  // Get and format date from data
  const timestamp = Date.now();
  const currentBlock = useBlockNumber();
  const startDate =
    proposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (proposal.startBlock - currentBlock),
          'seconds',
        )
      : undefined;

  const endDate =
    proposal && timestamp && currentBlock
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * (proposal.endBlock - currentBlock),
          'seconds',
        )
      : undefined;
  const now = dayjs();

  // Get total votes and format percentages for UI
  const totalVotes = proposal
    ? proposal.forCount + proposal.againstCount + proposal.abstainCount
    : undefined;
  const forPercentage = proposal && totalVotes ? (proposal.forCount * 100) / totalVotes : 0;
  const againstPercentage = proposal && totalVotes ? (proposal.againstCount * 100) / totalVotes : 0;
  const abstainPercentage = proposal && totalVotes ? (proposal.abstainCount * 100) / totalVotes : 0;

  // Only count available votes as of the proposal created block
  const availableVotes = useUserVotesAsOfBlock(proposal?.createdBlock ?? undefined);
  const hasSucceeded = proposal?.status === ProposalState.SUCCEEDED;

  const isQueued = proposal?.status === ProposalState.QUEUED;
  const isActive = proposal?.status === ProposalState.ACTIVE;
  const isPending = proposal?.status === ProposalState.PENDING;

  const isCancellable =
    (isQueued || isActive || isPending) &&
    proposal?.proposer?.toLowerCase() === account?.toLowerCase();

  const isAwaitingStateChange = () => {
    if (hasSucceeded) {
      return true;
    }
    if (proposal?.status === ProposalState.QUEUED) {
      return new Date() >= (proposal?.eta ?? Number.MAX_SAFE_INTEGER);
    }
    return false;
  };

  const isAwaitingDesctructiveStateChange = () => {
    if (isCancellable) {
      return true;
    }
    return false;
  };

  const startOrEndTimeCopy = () => {
    if (startDate?.isBefore(now) && endDate?.isAfter(now)) {
      return 'Ends';
    }
    if (endDate?.isBefore(now)) {
      return 'Ended';
    }
    return 'Starts';
  };

  const startOrEndTimeTime = () => {
    if (!startDate?.isBefore(now)) {
      return startDate;
    }
    return endDate;
  };

  const moveStateButtonAction = hasSucceeded ? 'Queue' : 'Execute';
  const moveStateAction = (() => {
    if (hasSucceeded) {
      return () => {
        if (proposal?.id) {
          return queueProposal(proposal.id);
        }
      };
    }
    return () => {
      if (proposal?.id) {
        return executeProposal(proposal.id);
      }
    };
  })();

  const desctructiveStateButtonAction = isCancellable ? 'Cancel' : '';
  const desctructiveStateAction = (() => {
    if (isCancellable) {
      return () => {
        if (proposal?.id) {
          return cancelProposal(proposal.id);
        }
      };
    }
  })();

  const onTransactionStateChange = useCallback(
    (
      tx: TransactionStatus,
      successMessage?: string,
      setPending?: (isPending: boolean) => void,
      getErrorMessage?: (error?: string) => string | undefined,
      onFinalState?: () => void,
    ) => {
      switch (tx.status) {
        case 'None':
          setPending?.(false);
          break;
        case 'Mining':
          setPending?.(true);
          break;
        case 'Success':
          setModal({
            title: 'Success',
            message: successMessage || 'Transaction Successful!',
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Fail':
          setModal({
            title: 'Transaction Failed',
            message: tx?.errorMessage || 'Please try again.',
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Exception':
          setModal({
            title: 'Error',
            message: getErrorMessage?.(tx?.errorMessage) || 'Please try again.',
            show: true,
          });
          setPending?.(false);
          onFinalState?.();
          break;
      }
    },
    [setModal],
  );

  useEffect(
    () => onTransactionStateChange(queueProposalState, 'Proposal Queued!', setQueuePending),
    [queueProposalState, onTransactionStateChange, setModal],
  );

  useEffect(
    () => onTransactionStateChange(executeProposalState, 'Proposal Executed!', setExecutePending),
    [executeProposalState, onTransactionStateChange, setModal],
  );

  useEffect(
    () => onTransactionStateChange(cancelProposalState, 'Proposal Canceled!', setCancelPending),
    [cancelProposalState, onTransactionStateChange, setModal],
  );

  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const {
    loading: votesLoading,
    error: votesError,
    data: voters,
  } = useQuery<ProposalVotes>(proposalVotesQuery(proposal?.id ?? '0'));

  const voterIds = voters?.votes?.map(v => v.voter.id);
  const {
    loading: delegatesLoading,
    error: delegatesError,
    data: delegateSnapshot,
  } = useQuery<Delegates>(delegateNounsAtBlockQuery(voterIds ?? [], proposal?.createdBlock ?? 0), {
    skip: !voters?.votes?.length,
  });
  const loading = votesLoading || delegatesLoading;
  const error = votesError || delegatesError;

  const { delegates } = delegateSnapshot || {};
  const delegateToNounIds = delegates?.reduce<Record<string, string[]>>((acc, curr) => {
    acc[curr.id] = curr?.nounsRepresented?.map(nr => nr.id) ?? [];
    return acc;
  }, {});

  const data = voters?.votes?.map(v => ({
    delegate: v.voter.id,
    supportDetailed: v.supportDetailed,
    nounsRepresented: delegateToNounIds?.[v.voter.id] ?? [],
  }));

  const [showToast, setShowToast] = useState(true);
  useEffect(() => {
    if (showToast) {
      setTimeout(() => {
        setShowToast(false);
      }, 5000);
    }
  }, [showToast]);

  if (!proposal || loading || !data) {
    return (
      <div className={classes.spinner}>
        <Spinner animation="border" />
      </div>
    );
  }

  if (error) {
    return <>Failed to fetch</>;
  }

  const isWalletConnected = !(activeAccount === undefined);
  const isActiveForVoting = startDate?.isBefore(now) && endDate?.isAfter(now);

  const forNouns = getNounVotes(data, 1);
  const againstNouns = getNounVotes(data, 0);
  const abstainNouns = getNounVotes(data, 2);

  return (
    <Section fullWidth={false} className={classes.votePage}>
      <VoteModal
        show={showVoteModal}
        onHide={() => setShowVoteModal(false)}
        proposalId={proposal?.id}
        availableVotes={availableVotes || 0}
      />
      <Col lg={10} className={classes.wrapper}>
        {proposal && (
          <ProposalHeader
            proposal={proposal}
            isActiveForVoting={isActiveForVoting}
            isWalletConnected={isWalletConnected}
            submitButtonClickHandler={() => setShowVoteModal(true)}
          />
        )}
      </Col>
      <Col lg={10} className={clsx(classes.proposal, classes.wrapper)}>
        {(isAwaitingStateChange() || isAwaitingDesctructiveStateChange()) && (
          <Row className={clsx(classes.section, classes.transitionStateButtonSection)}>
            <Col className="d-grid gap-4">
              {isAwaitingStateChange() && (
                <Button
                  onClick={moveStateAction}
                  disabled={isQueuePending || isExecutePending}
                  variant="dark"
                  className={classes.transitionStateButton}
                >
                  {isQueuePending || isExecutePending ? (
                    <Spinner animation="border" />
                  ) : (
                    `${moveStateButtonAction} Proposal ⌐◧-◧`
                  )}
                </Button>
              )}

              {isAwaitingDesctructiveStateChange() && (
                <Button
                  onClick={desctructiveStateAction}
                  disabled={isCancelPending}
                  variant="danger"
                  className={classes.desturctiveTransitionStateButton}
                >
                  {isCancelPending ? (
                    <Spinner animation="border" />
                  ) : (
                    `${desctructiveStateButtonAction} Proposal ⌐◧-◧`
                  )}
                </Button>
              )}
            </Col>
          </Row>
        )}

        <p
          onClick={() => setIsDelegateView(!isDelegateView)}
          className={classes.toggleDelegateVoteView}
        >
          {isDelegateView ? 'Switch to Noun view' : 'Switch to delegate view'}
        </p>
        <Row>
          <VoteCard
            proposal={proposal}
            percentage={forPercentage}
            nounIds={forNouns}
            variant={VoteCardVariant.FOR}
            delegateView={isDelegateView}
            delegateGroupedVoteData={data}
            lilnounIds={[]}
          />
          <VoteCard
            proposal={proposal}
            percentage={againstPercentage}
            nounIds={againstNouns}
            variant={VoteCardVariant.AGAINST}
            delegateView={isDelegateView}
            delegateGroupedVoteData={data}
            lilnounIds={[]}
          />
          <VoteCard
            proposal={proposal}
            percentage={abstainPercentage}
            nounIds={abstainNouns}
            variant={VoteCardVariant.ABSTAIN}
            delegateView={isDelegateView}
            delegateGroupedVoteData={data}
            lilnounIds={[]}
          />
        </Row>

        {/* TODO abstract this into a component  */}
        <Row>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <Row className={classes.voteMetadataRow}>
                  <Col className={classes.voteMetadataRowTitle}>
                    <h1>Threshold</h1>
                  </Col>
                  <Col className={classes.thresholdInfo}>
                    <span>Quorum</span>
                    <h3>{proposal.quorumVotes} votes</h3>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <Row className={classes.voteMetadataRow}>
                  <Col className={classes.voteMetadataRowTitle}>
                    <h1>{startOrEndTimeCopy()}</h1>
                  </Col>
                  <Col className={classes.voteMetadataTime}>
                    <span>{startOrEndTimeTime() && startOrEndTimeTime()?.format('h:mm A z')}</span>
                    <h3>{startOrEndTimeTime() && startOrEndTimeTime()?.format('MMM D, YYYY')}</h3>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
          <Col xl={4} lg={12}>
            <Card className={classes.voteInfoCard}>
              <Card.Body className="p-2">
                <Row className={classes.voteMetadataRow}>
                  <Col className={classes.voteMetadataRowTitle}>
                    <h1>Snapshot</h1>
                  </Col>
                  <Col className={classes.snapshotBlock}>
                    <span>Taken at block</span>
                    <h3>{proposal.createdBlock}</h3>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        <ProposalContent proposal={proposal} />
      </Col>
    </Section>
  );
};

export default VotePage;
